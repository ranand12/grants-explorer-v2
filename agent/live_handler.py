"""
Voice + vision session handler — browser ⇄ ADK run_live ⇄ Gemini 3.8 Live.

Upstream (browser → agent), over one WebSocket:
  binary frame                      16 kHz mono PCM16 mic audio
  {"type":"text","text":...}        typed message mid-conversation
  {"type":"image","data":b64jpeg}   screen-share / camera frame (~1 fps)
  {"type":"ui_action","name":...,"context":{...}}   A2UI / dashboard button click
  {"type":"end"}                    graceful hang-up

Downstream (agent → browser):
  audio, input_transcript, output_transcript, thought, turn_complete,
  interrupted, status, state_update, error, connected
  + everything tools publish on the ui_bus: dashboard, draft_section, a2ui,
    shortlist, profile, tool_start, tool_end

Session continuity: the client passes session_id (= the CopilotKit thread id)
so voice resumes the same ADK session as the text chat. ADK seeds prior history
into the Live connection and transparently reconnects with resumption handles
when Gemini sends GoAway (~10 min connection limit).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types

import config
import sources
import ui_bus

logger = logging.getLogger(__name__)

MAX_FRAME_BYTES = 1_500_000  # a 768px JPEG is ~50-150 KB; reject anything absurd

UI_ACTION_TEMPLATES = {
    "show_grant_detail": "Show me the full details for \"{opportunity_title}\" (opportunity_id {opportunity_id}).",
    "save_to_shortlist": "Save \"{opportunity_title}\" (opportunity_id {opportunity_id}, {agency_name}) to my shortlist.",
    "draft_proposal": "I want to draft a proposal for \"{opportunity_title}\" ({opportunity_number}, {agency_name}, opportunity_id {opportunity_id}).",
    "remove_from_shortlist": "Remove \"{opportunity_title}\" from my shortlist.",
    "compare": "Compare these grants: {titles}.",
}


def ui_action_to_text(name: str, context: dict) -> str:
    """Turn a dashboard click into a message the model can act on."""
    ctx = {k: "; ".join(map(str, v)) if isinstance(v, list) else v for k, v in (context or {}).items()}
    tmpl = UI_ACTION_TEMPLATES.get(name)
    if tmpl:
        try:
            return "[UI ACTION] " + tmpl.format_map(_Default(ctx))
        except Exception:
            pass
    return f"[UI ACTION] {name}: {json.dumps(ctx)}"


class _Default(dict):
    def __missing__(self, key):
        return "unknown"


def _run_config(voice: str, deep: bool) -> RunConfig:
    return RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)),
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(custom_vocabulary=config.TRANSCRIPTION_VOCABULARY),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # Survive the ~10 min connection cap and long conversations
        session_resumption=types.SessionResumptionConfig(),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100_000, sliding_window=types.SlidingWindow(target_tokens=80_000),
        ),
    )


async def handle_live_session(websocket: WebSocket, *, live_runner, deep_runner, session_service):
    qp = websocket.query_params
    if config.LIVE_AUTH_TOKEN and qp.get("token") != config.LIVE_AUTH_TOKEN:
        await websocket.close(code=4401)
        return
    await websocket.accept()

    user_id = (qp.get("user_id") or "anonymous")[:128]
    session_id = (qp.get("session_id") or str(uuid.uuid4()))[:128]
    voice = qp.get("voice") if qp.get("voice") in config.VOICES else config.DEFAULT_VOICE
    deep = qp.get("mode") == "deep" and config.DEEP_MODE_AVAILABLE
    runner = deep_runner if deep else live_runner

    send_lock = asyncio.Lock()
    closed = asyncio.Event()

    async def send(msg: dict):
        if closed.is_set():
            return
        try:
            async with send_lock:
                await websocket.send_text(json.dumps(msg, default=str))
        except Exception:
            closed.set()

    session = await session_service.get_session(app_name=config.APP_NAME, user_id=user_id, session_id=session_id)
    resumed = session is not None
    if not session:
        session = await session_service.create_session(app_name=config.APP_NAME, user_id=user_id,
                                                       session_id=session_id)

    queue = LiveRequestQueue()
    bus = ui_bus.subscribe(session_id)

    await send({
        "type": "connected", "session_id": session_id, "resumed": resumed, "voice": voice,
        "mode": "deep" if deep else "live", "model": runner.agent.model,
        # Rehydrate the dashboard with whatever the text chat already produced
        "state": {k: v for k, v in session.state.items() if not k.startswith("temp:")},
    })
    logger.info("live connected session=%s user=%s mode=%s voice=%s resumed=%s",
                session_id, user_id, "deep" if deep else "live", voice, resumed)

    async def upstream():
        while not closed.is_set():
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            if msg.get("bytes"):
                queue.send_realtime(types.Blob(data=msg["bytes"], mime_type="audio/pcm;rate=16000"))
                continue
            if not msg.get("text"):
                continue
            try:
                data = json.loads(msg["text"])
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "text" and data.get("text"):
                queue.send_content(types.Content(role="user", parts=[types.Part(text=str(data["text"])[:4000])]))
            elif kind == "image" and data.get("data"):
                raw = base64.b64decode(data["data"])
                if len(raw) <= MAX_FRAME_BYTES:
                    queue.send_realtime(types.Blob(data=raw, mime_type=data.get("mime_type") or "image/jpeg"))
            elif kind == "ui_action":
                text = ui_action_to_text(str(data.get("name", "")), data.get("context") or {})
                queue.send_content(types.Content(role="user", parts=[types.Part(text=text)]))
            elif kind == "end":
                return

    async def downstream():
        async for event in runner.run_live(user_id=user_id, session_id=session_id,
                                           live_request_queue=queue, run_config=_run_config(voice, deep)):
            if closed.is_set():
                return
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.inline_data and part.inline_data.data and \
                            (part.inline_data.mime_type or "").startswith("audio"):
                        await send({"type": "audio", "data": base64.b64encode(part.inline_data.data).decode()})
                    elif part.thought and part.text:
                        await send({"type": "thought", "text": part.text})

            if event.input_transcription and event.input_transcription.text:
                await send({"type": "input_transcript", "text": event.input_transcription.text,
                            "finished": bool(event.input_transcription.finished)})
            if event.output_transcription and event.output_transcription.text:
                await send({"type": "output_transcript", "text": event.output_transcription.text,
                            "finished": bool(event.output_transcription.finished)})

            # Blocking tools come back through state_delta; background ones via ui_bus
            delta = event.actions.state_delta if event.actions else None
            if delta and "dashboard_type" in delta:
                await send({"type": "state_update", **delta})

            # Google Search grounding → citation chips in captions + the screen's Sources panel
            web, supports, search_html = sources.from_grounding(event.grounding_metadata)
            if web:
                await send({"type": "citations", "sources": web[:8], "supports": supports,
                            "search_html": search_html})

            if event.interaction_status:
                await send({"type": "status", "status": str(event.interaction_status)})
            if event.interrupted:
                await send({"type": "interrupted"})
            if event.turn_complete:
                await send({"type": "turn_complete"})
            if event.go_away:
                await send({"type": "status", "status": "reconnecting"})
            if event.error_code:
                await send({"type": "error", "message": event.error_message or str(event.error_code)})

    async def forward_bus():
        while True:
            await send(await bus.get())

    tasks = [asyncio.create_task(upstream(), name="upstream"),
             asyncio.create_task(downstream(), name="downstream"),
             asyncio.create_task(forward_bus(), name="ui_bus")]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                logger.error("live %s failed: %s", t.get_name(), exc, exc_info=exc)
                await send({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
    finally:
        closed.set()
        queue.close()
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        ui_bus.unsubscribe(session_id, bus)
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("live closed session=%s", session_id)
