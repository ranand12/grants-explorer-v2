"""
Grants Explorer Agent v2 — ADK 2.9 + Gemini 3.8 Live.

Three agents, one brain, one session store:
  - grants_advisor        text chat via AG-UI / CopilotKit   (gemini-3.5-flash)
  - grants_advisor_live   real-time voice + vision           (gemini-3.8-live)
  - grants_advisor_deep   "deep think" voice                 (gemini-3.8-live-extended-thinking)

Text and voice share one ADK session (thread id == session id) in a persistent
DatabaseSessionService, so you can type a question, switch to voice, and the
agent remembers the whole conversation. `user:` state (shortlist, profile)
persists across sessions for the same browser user.
"""

from __future__ import annotations

import logging
from datetime import date

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.adk.tools import FunctionTool, google_search
from google.genai import types

import config
import sources
import ui_bus
from tools import ALL_TOOLS, after_tool, before_tool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("grants")

# Tools that take seconds; on 3.8 Live they run in the background while the agent keeps talking
LONG_RUNNING = {"draft_grant_response", "compare_grants"}


# ──────────────────────────────────────────────
# Instruction — dynamic, so it carries today's date and the user's memory
# ──────────────────────────────────────────────

BASE_INSTRUCTION = """You are a Grants Explorer assistant that helps researchers, nonprofits, universities, and small businesses find and apply for U.S. federal grants. Data comes live from Grants.gov (Simpler Grants API).

Personality: warm, sharp, efficient. Navigating grants is overwhelming — make it feel easy. Be honest that this is a demo and point people to official sites for final requirements.

TOOLS — pick the most specific one:
1. search_grants — topic/keyword search with filters ("AI grants", "NSF grants for nonprofits", "grants over $100k").
2. get_grant_detail — one specific grant ("tell me more about...", "requirements for 24-584"). Pass opportunity_id when you have it.
3. get_grant_stats — landscape overview with charts ("how many", "overview", "breakdown").
4. get_deadlines — closing soon ("due this month", "urgent").
5. get_agency_overview — an agency's portfolio ("what does NSF offer?").
6. get_eligible_grants — by applicant type ("I'm a nonprofit"). Map: nonprofit/501c3 -> nonprofits_non_higher_education_with_501c3; small business -> small_businesses; university/college -> public_and_state_institutions_of_higher_education; individual -> individuals; tribal -> federally_recognized_native_american_tribal_governments; state government -> state_governments.
7. compare_grants — side-by-side of 2-4 grants ("compare the first two", "which is better").
8. draft_grant_response — writes a full proposal with AI. Gather project title and a 1-2 sentence project idea first if you don't have them (ask once, briefly), then call it. It runs in the background: tell the user it's being written and keep chatting.
9. compose_dashboard — design a custom view from metrics, bar charts, callouts, checklists, text, and grant lists. Use for briefings, strategies, readiness checklists, "summarize what we found", or anything the fixed views don't cover.
10. save_to_shortlist / remove_from_shortlist / show_shortlist — the user's saved grants (remembered across sessions).
11. remember_user_profile — call silently whenever the user reveals their organization, org type, research area, location, or career stage.
12. google_search — current events and context NOT in Grants.gov: agency budget news, policy changes, program announcements, success rates, tips. Never use it to list open grants — use the Grants.gov tools for that.

RULES:
- ALWAYS call a tool for questions about grants, funding, agencies, deadlines, or eligibility. Never answer those from memory.
- Results appear on the dashboard. Summarize in 1-2 sentences; don't read lists or numbers aloud in full.
- If a tool returns status "no_results", do NOT repeat the same call. You may try ONE broader variation, then tell the user and suggest alternatives.
- If a tool returns status "error" with retryable true, retry at most once.
- "Ordinals" like "the first one" / "the second grant" refer to the order shown in the most recent results.
- Messages starting with [UI ACTION] mean the user clicked a button on the dashboard — act on it immediately without asking for confirmation.
- For general advice that needs no data (how to write a budget justification, what indirect costs are), answer conversationally."""

VOICE_ADDENDUM = """

VOICE MODE: You are speaking out loud. Keep replies short and natural — 1-3 sentences, no markdown, no lists, no URLs. Say numbers the way a person would ("about two million dollars"). If the user shares their screen or camera, you can see it: use what's visible (e.g. a NOFO PDF, a budget sheet) to help them."""


def _memory_block(ctx: ReadonlyContext) -> str:
    state = ctx.state
    lines = [f"\n\nToday is {date.today():%A, %B %d, %Y}."]
    profile = state.get("user:profile") or {}
    if profile:
        lines.append("What you know about this user (use it to personalize; never recite it): "
                     + "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in profile.items()))
    shortlist = state.get("user:shortlist") or []
    if shortlist:
        lines.append("User's shortlist: " + "; ".join(
            f"{g['opportunity_title']} ({g.get('agency_name') or '?'}, closes {g.get('close_date') or 'TBD'})"
            for g in shortlist[:10]))
    grants = state.get("grants_data") or []
    if grants:
        lines.append("Most recent results, in dashboard order: " + "; ".join(
            f"{i + 1}. {g['opportunity_title']} [id {g.get('opportunity_id')}, #{g.get('opportunity_number')}, {g.get('agency_name')}]"
            for i, g in enumerate(grants[:10])))
    return "\n".join(lines)


def text_instruction(ctx: ReadonlyContext) -> str:
    return BASE_INSTRUCTION + _memory_block(ctx)


def voice_instruction(ctx: ReadonlyContext) -> str:
    return BASE_INSTRUCTION + VOICE_ADDENDUM + _memory_block(ctx)


# ──────────────────────────────────────────────
# Tools
# ──────────────────────────────────────────────

def build_tools(scheduled: bool) -> list:
    """Wrap the shared tool functions. `scheduled` = Gemini 3.8 Live non-blocking scheduling."""
    tools = []
    for fn in ALL_TOOLS:
        tool = FunctionTool(fn)
        if scheduled and fn.__name__ in LONG_RUNNING:
            # FunctionTool's ctor doesn't take it; ADK reads the attribute. WHEN_IDLE =
            # deliver the result once the model finishes its current sentence.
            tool.response_scheduling = types.FunctionResponseScheduling.WHEN_IDLE
        tools.append(tool)
    tools.append(google_search)
    return tools


# ──────────────────────────────────────────────
# Agents
# ──────────────────────────────────────────────

async def publish_citations(callback_context, llm_response):
    """Text path: Google Search grounding → citation chips via the ui_bus (SSE)."""
    web, supports, search_html = sources.from_grounding(getattr(llm_response, "grounding_metadata", None))
    if web:
        ui_bus.publish(callback_context.session.id, {
            "type": "citations", "sources": web[:8], "supports": supports, "search_html": search_html})
    return None


# Ride out transient "high demand" 503s / 429s instead of surfacing them in chat
RETRY = types.HttpRetryOptions(attempts=4, initial_delay=1.0, exp_base=2.0, http_status_codes=[429, 500, 503, 504])

text_agent = LlmAgent(
    model=Gemini(model=config.TEXT_MODEL, retry_options=RETRY),
    name="grants_advisor",
    instruction=text_instruction,
    tools=build_tools(scheduled=False),
    before_tool_callback=before_tool,
    after_tool_callback=after_tool,
    after_model_callback=publish_citations,
    # Required when mixing built-in google_search with function tools on Gemini 3.x
    generate_content_config=types.GenerateContentConfig(
        tool_config=types.ToolConfig(include_server_side_tool_invocations=True),
    ),
)

live_agent = LlmAgent(
    model=config.LIVE_MODEL,
    name="grants_advisor_live",
    instruction=voice_instruction,
    tools=build_tools(scheduled=True),
    before_tool_callback=before_tool,
    after_tool_callback=after_tool,
)

# Extended Thinking: async tools only (no scheduling), thinking level is mandatory
deep_agent = LlmAgent(
    model=config.DEEP_LIVE_MODEL,
    name="grants_advisor_deep",
    instruction=voice_instruction,
    tools=build_tools(scheduled=False),
    before_tool_callback=before_tool,
    after_tool_callback=after_tool,
    generate_content_config=types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level=config.DEEP_THINKING_LEVEL, include_thoughts=True),
    ),
)

session_service = DatabaseSessionService(db_url=config.SESSION_DB_URL)

live_runner = Runner(app_name=config.APP_NAME, agent=live_agent, session_service=session_service)
deep_runner = Runner(app_name=config.APP_NAME, agent=deep_agent, session_service=session_service)


def _user_id(input_) -> str:
    """Browser-generated id, forwarded by CopilotKit, so text + voice + user: state line up."""
    props = getattr(input_, "forwarded_props", None) or {}
    if isinstance(props, dict) and (props.get("user_id") or props.get("userId")):
        return str(props.get("user_id") or props.get("userId"))
    # Fallback: the frontend's thread ids are "<user_id>~<conversation_id>"
    thread_id = getattr(input_, "thread_id", "") or ""
    return thread_id.split("~", 1)[0] if "~" in thread_id else "anonymous"


adk_agent = ADKAgent(
    adk_agent=text_agent,
    app_name=config.APP_NAME,
    user_id_extractor=_user_id,
    session_service=session_service,
    use_in_memory_services=False,
    use_thread_id_as_session_id=True,
    # The voice path shares these sessions — never let AG-UI's janitor delete them
    delete_session_on_cleanup=False,
    save_session_to_memory_on_cleanup=False,
)


# ──────────────────────────────────────────────
# HTTP
# ──────────────────────────────────────────────

app = FastAPI(title="Grants Explorer Agent v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/api/config")
async def api_config():
    return {
        "live_model": config.LIVE_MODEL,
        "deep_model": config.DEEP_LIVE_MODEL if config.DEEP_MODE_AVAILABLE else None,
        "deep_mode_available": config.DEEP_MODE_AVAILABLE,
        "voices": config.VOICES,
        "default_voice": config.DEFAULT_VOICE,
        "auth_required": bool(config.LIVE_AUTH_TOKEN),
    }


@app.get("/api/state/{user_id}/{session_id}")
async def get_state(user_id: str, session_id: str):
    """Rehydrate the dashboard after a reload or reconnect."""
    s = await session_service.get_session(app_name=config.APP_NAME, user_id=user_id, session_id=session_id)
    if not s:
        user_state = await _user_state(user_id)
        return {"exists": False, "state": user_state}
    return {"exists": True, "state": dict(s.state)}


async def _user_state(user_id: str) -> dict:
    # A throwaway read of any session gives us merged user: state; cheap enough for a demo
    listing = await session_service.list_sessions(app_name=config.APP_NAME, user_id=user_id)
    for s in listing.sessions[:1]:
        full = await session_service.get_session(app_name=config.APP_NAME, user_id=user_id, session_id=s.id)
        if full:
            return {k: v for k, v in full.state.items() if k.startswith("user:")}
    return {}


@app.get("/api/events/{session_id}")
async def events(session_id: str):
    """SSE mirror of the ui_bus for the text chat (tool chips, streaming draft sections)."""
    import asyncio
    import json

    from fastapi.responses import StreamingResponse

    import ui_bus

    async def stream():
        q = ui_bus.subscribe(session_id)
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(evt, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            ui_bus.unsubscribe(session_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


from live_handler import handle_live_session  # noqa: E402


@app.websocket("/live")
async def live_endpoint(websocket: WebSocket):
    await handle_live_session(websocket, live_runner=live_runner, deep_runner=deep_runner,
                              session_service=session_service)


# AG-UI text endpoint last so it doesn't shadow the routes above
add_adk_fastapi_endpoint(app, adk_agent, path="/")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
