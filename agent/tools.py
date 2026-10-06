"""
Grants Explorer tools — shared by the text agent and the live voice agents.

v2 changes vs v1:
- async (httpx.AsyncClient) so the Live API loop never blocks on Grants.gov
- structured results {status, retryable, message, ...} — Google's required
  mitigation for Gemini 3.8 Live's redundant-tool-call issue on empty results
- every dashboard update goes to session state (AG-UI text path) AND the ui_bus
  (live path, including NON_BLOCKING background tools)
- new tools: compare_grants, compose_dashboard (A2UI), shortlist, user profile
- draft_grant_response writes real sections with Gemini in the background
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional

from google import genai
from google.adk.tools import ToolContext
from google.genai import types
from pydantic import BaseModel, Field

import a2ui_builder
import sources as S
import ui_bus
from config import DRAFT_MODEL
from grant_templates import get_grant_sections
from grants_api import get_opportunity_detail, search_opportunities

logger = logging.getLogger(__name__)

_genai_client: genai.Client | None = None


def _genai() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        # Section writers fan out in parallel; retry transient 429/503s per section
        _genai_client = genai.Client(http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(
            attempts=4, initial_delay=1.0, exp_base=2.0, http_status_codes=[429, 500, 503, 504])))
    return _genai_client


# ──────────────────────────────────────────────
# Result + dashboard helpers
# ──────────────────────────────────────────────

def _ok(message: str, **data) -> dict:
    return {**data, "status": "ok", "retryable": False, "message": message}


def _empty(message: str) -> dict:
    # retryable=False + an explicit instruction stops 3.8 Live from hammering
    # the same call when a search legitimately has no results.
    return {"status": "no_results", "retryable": False,
            "message": message + " Do not repeat this exact call; suggest broader terms to the user instead."}


def _error(message: str, retryable: bool = True) -> dict:
    return {"status": "error", "retryable": retryable, "message": message}


def _session_id(tool_context: ToolContext) -> str | None:
    try:
        return tool_context.session.id
    except Exception:
        return None


def _show(tool_context: ToolContext, dashboard_type: str, last_query: str,
          sources: list[dict] | None = None, **data) -> None:
    """Point the dashboard at a view: session state for AG-UI, ui_bus for live.
    `sources` = citations for this screen (see sources.py); always reset per screen."""
    data["sources"] = sources or []
    tool_context.state["dashboard_type"] = dashboard_type
    tool_context.state["last_query"] = last_query
    for k, v in data.items():
        tool_context.state[k] = v
    ui_bus.publish(_session_id(tool_context), {
        "type": "dashboard", "dashboard_type": dashboard_type, "last_query": last_query, **data,
    })


def _show_a2ui(tool_context: ToolContext, messages: list[dict], last_query: str,
               sources: list[dict] | None = None) -> None:
    _show(tool_context, "a2ui", last_query, sources=sources, a2ui_messages=messages)


def _compact(r: dict) -> dict:
    return {"title": r["opportunity_title"], "agency": r["agency_name"], "id": r.get("opportunity_id"),
            "number": r.get("opportunity_number"), "ceiling": r.get("award_ceiling"),
            "close_date": r.get("close_date"), "opportunity_status": r.get("opportunity_status")}


# ──────────────────────────────────────────────
# Tool 1: Search — the workhorse, handles most queries
# ──────────────────────────────────────────────

async def search_grants(
    query: str,
    tool_context: ToolContext,
    agency: str = "",
    applicant_type: str = "",
    funding_instrument: str = "",
    funding_category: str = "",
    award_floor: int = 0,
    award_ceiling: int = 0,
) -> dict:
    """Search for government grant opportunities matching a keyword or field of study, with optional filters.

    Use filters to narrow results when asked, e.g. "only NSF grants" -> agency="NSF",
    "grants for nonprofits" -> applicant_type="nonprofits".

    Args:
        query: The topic, field, or keyword to search for grants (e.g. "renewable energy", "education").
        tool_context: The tool context for accessing state.
        agency: Filter by agency code, comma-separated (e.g. "NSF", "NIH", "DOE", "EPA", "USAID", "DOC", "ED").
        applicant_type: Filter by who can apply, comma-separated. Values: "individuals", "nonprofits", "state_governments", "county_governments", "city_or_township_governments", "independent_school_districts", "public_and_state_institutions_of_higher_education", "private_institutions_of_higher_education", "small_businesses", "for_profit_organizations_other_than_small_businesses", "unrestricted".
        funding_instrument: Filter by funding type, comma-separated. Values: "grant", "cooperative_agreement", "procurement_contract", "other".
        funding_category: Filter by category, comma-separated. Values: "agriculture", "arts", "business_and_commerce", "community_development", "consumer_protection", "disaster_prevention_and_relief", "education", "employment_labor_and_training", "energy", "environment", "food_and_nutrition", "health", "housing", "humanities", "information_technology", "infrastructure_investment_and_jobs_act", "income_security_and_social_services", "law_justice_and_legal_services", "natural_resources", "opportunity_zone_benefits", "regional_development", "science_technology_and_other_research_and_development", "transportation", "other".
        award_floor: Minimum award amount (0 means no filter).
        award_ceiling: Maximum award amount (0 means no filter).
    """
    try:
        data = await search_opportunities(
            query,
            max_results=10,
            agency=agency or None,
            applicant_type=applicant_type or None,
            funding_instrument=funding_instrument or None,
            funding_category=funding_category or None,
            award_floor=award_floor if award_floor > 0 else None,
            award_ceiling=award_ceiling if award_ceiling > 0 else None,
        )
    except Exception as e:
        return _error(f"Grants.gov search failed: {e}")

    results = data["results"]
    _show(tool_context, "grants", query, grants_data=results, sources=[S.grants_search(
        query, data, "The grant cards on this screen", agency=agency, applicant_type=applicant_type,
        funding_instrument=funding_instrument, funding_category=funding_category)])

    if not results:
        return _empty(f"No open grant opportunities found for '{query}'.")
    return _ok("Results are on the dashboard. Summarize in 1-2 sentences.",
               count=len(results), top_grants=[_compact(r) for r in results[:5]])


# ──────────────────────────────────────────────
# Tool 2: Draft — Gemini writes the proposal in the background
# ──────────────────────────────────────────────

_DRAFT_PROMPT = """You are an expert federal grant writer. Write the "{heading}" section of a proposal.

Opportunity: {opportunity_title} ({opportunity_number}) from {agency_name}
Applicant organization: {organization_name}
Project title: {project_title}
Principal investigator: {principal_investigator}
Requested amount: {requested_amount}
Duration: {project_duration_months} months
Applicant's project idea: {project_summary}

Official opportunity description (ground your writing in this):
{description}

Agency-specific structure to follow for this section:
{scaffold}

Sources you may cite:
{source_list}

Rules:
- Write polished, specific, persuasive prose in the agency's expected format.
- Use Markdown: **bold** labels, "- " bullets, numbered lists, and pipe tables where the scaffold has them.
- Where a fact is genuinely unknown (names, numbers), leave a short [bracketed placeholder].
- Do not invent facts about the applicant (past projects, results, publications, partners, staff, numbers).
  Write a [bracketed placeholder] for them instead, e.g. "[number] open-source packages".
- Citations: at the end of a paragraph or bullet that relies on a source above, append its tag once,
  e.g. "... AI literacy [S1]." or "[S1][S2]". Use only the tags listed; at most two tags per paragraph. Don't tag
  placeholders, generic proposal language or the cover page.
- Evidence flags: if you still state a specific factual claim no source supports (a statistic, a prior
  result, a named partner), wrap just that claim in double square brackets, e.g.
  [[Our 2024 pilot reached 1,200 students]]. Flags should be rare — prefer a placeholder.
- Do not repeat the section heading. Keep it under 350 words.
"""


_TAG = re.compile(r"\[(S\d+)\]")
_TAG_GROUP = re.compile(r"\[(S\d+(?:\s*[,;]\s*S\d+)+)\]")  # [S1, S2] → [S1][S2]
_FLAG = re.compile(r"\[\[(.+?)\]\]", re.S)


def _draft_sources(detail: dict | None, project_summary: str, profile: dict, agency_name: str) -> list[dict]:
    """Numbered sources the section writers may cite ([S1], [S2], ...)."""
    out = []
    if detail:
        out.append(S.grant_record(detail, "Official description, eligibility and award details") |
                   {"prompt": "Official Grants.gov listing for this opportunity (description above)"})
    if project_summary:
        out.append(S.your_input("Your project idea", project_summary, "Aims, approach and framing") |
                   {"prompt": f"The applicant's own project idea: {project_summary[:600]}"})
    if profile:
        desc = "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in profile.items())
        out.append(S.your_input("Your saved profile", desc, "Organization and capacity details") |
                   {"prompt": f"The applicant's saved profile: {desc}"})
    for i, src in enumerate(out, 1):
        src["tag"] = f"S{i}"
    # Listed on the screen, but not citable: it shapes structure, it isn't evidence
    out.append(S.template(f"{agency_name or 'Agency'} proposal structure (built-in template)",
                          "Section structure and required elements"))
    return out


async def _write_section(section: dict, ctx: dict) -> str:
    prompt = _DRAFT_PROMPT.format(heading=section["heading"], scaffold=section["content"][:2500], **ctx)
    resp = await _genai().aio.models.generate_content(
        model=DRAFT_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level="low")),
    )
    return (resp.text or "").strip() or section["content"]


async def draft_grant_response(
    opportunity_title: str,
    opportunity_number: str,
    agency_name: str,
    tool_context: ToolContext,
    opportunity_id: str = "",
    organization_name: str = "",
    project_title: str = "",
    principal_investigator: str = "",
    pi_email: str = "",
    project_summary: str = "",
    requested_amount: int = 0,
    project_duration_months: int = 12,
) -> dict:
    """Draft a full grant application for a specific opportunity. Sections are written by AI in the background and stream onto the dashboard; you can keep talking with the user while it runs. Use when the user wants to apply, respond, or draft a proposal.

    Args:
        opportunity_title: The title of the grant opportunity being responded to.
        opportunity_number: The opportunity number / NOFO number.
        agency_name: The funding agency name.
        tool_context: The tool context for accessing state.
        opportunity_id: The opportunity UUID if known (improves grounding in the official description).
        organization_name: The applicant's organization or university name.
        project_title: The proposed project title.
        principal_investigator: Name of the Principal Investigator (PI).
        pi_email: PI's email address.
        project_summary: The user's project idea in their own words (2-3 sentences).
        requested_amount: Requested funding amount in dollars (0 if not specified).
        project_duration_months: Project duration in months (default 12).
    """
    profile = tool_context.state.get("user:profile") or {}
    organization_name = organization_name or profile.get("organization_name", "")
    sid = _session_id(tool_context)
    draft_id = uuid.uuid4().hex[:8]
    started = time.monotonic()

    sections = get_grant_sections(
        opportunity_title, opportunity_number, agency_name,
        organization_name, project_title, principal_investigator,
        pi_email, project_summary, requested_amount, project_duration_months,
    )

    try:
        detail = await _resolve_grant(opportunity_title, opportunity_number, opportunity_id)
    except Exception:
        detail = None
    summary = project_summary or profile.get("research_interests") or ""
    draft_sources = _draft_sources(detail, project_summary, profile, agency_name)
    valid_tags = {s["tag"] for s in draft_sources if s.get("tag")}
    screen_sources = [{k: v for k, v in s.items() if k != "prompt"} for s in draft_sources] + [
        S.ai_generated("All section prose; highlighted claims need your evidence")]
    ctx = dict(
        opportunity_title=opportunity_title, opportunity_number=opportunity_number, agency_name=agency_name,
        organization_name=organization_name or "[Organization]", project_title=project_title or "[Project title]",
        principal_investigator=principal_investigator or "[PI]",
        requested_amount=f"${requested_amount:,}" if requested_amount else "[Amount]",
        project_duration_months=project_duration_months,
        project_summary=summary or "[Not provided — infer from the opportunity]",
        description=((detail or {}).get("description") or "Not available.")[:4000],
        source_list="\n".join(f"[{s['tag']}] {s['prompt']}" for s in draft_sources if s.get("tag")),
    )

    draft = {
        "draft_id": draft_id,
        "opportunity_title": opportunity_title, "opportunity_number": opportunity_number,
        "agency_name": agency_name, "organization_name": organization_name,
        "project_title": project_title, "principal_investigator": principal_investigator,
        "generating": True,
        # Cover page is deterministic; everything else is written by Gemini
        "sections": [dict(s, pending=(i > 0)) for i, s in enumerate(sections)],
    }
    last_query = f"Grant Response: {project_title or opportunity_title}"
    draft["sources"] = screen_sources
    _show(tool_context, "grant_draft", last_query, grant_draft=draft, sources=screen_sources)

    async def run(i: int, section: dict):
        try:
            content = await _write_section(section, ctx)
        except Exception as e:
            logger.warning("draft section %s failed: %s", section["heading"], e)
            content = section["content"]  # fall back to the agency template
        # Drop tags the model invented; count what the section cites and what it flags
        content = _TAG_GROUP.sub(lambda m: "".join(f"[{t.strip()}]" for t in re.split(r"[,;]", m.group(1))), content)
        content = _TAG.sub(lambda m: m.group(0) if m.group(1) in valid_tags else "", content)
        draft["sections"][i] = {"heading": section["heading"], "content": content, "pending": False,
                                "citations": sorted(set(_TAG.findall(content)), key=lambda t: int(t[1:])),
                                "needs_evidence": len(_FLAG.findall(content))}
        ui_bus.publish(sid, {"type": "draft_section", "draft_id": draft_id, "index": i,
                             "section": draft["sections"][i]})

    await asyncio.gather(*(run(i, s) for i, s in enumerate(sections) if i > 0))
    draft["generating"] = False
    _show(tool_context, "grant_draft", last_query, grant_draft=draft, sources=screen_sources)

    return _ok(
        f"The {len(sections)}-section draft is complete on the dashboard. Tell the user briefly and offer to refine any section.",
        sections=[s["heading"] for s in sections], seconds=round(time.monotonic() - started, 1),
    )


# ──────────────────────────────────────────────
# Tool 3: Detail — deep dive into one specific grant
# ──────────────────────────────────────────────

async def _resolve_grant(title: str, number: str = "", opportunity_id: str = "") -> dict | None:
    if opportunity_id:
        detail = await get_opportunity_detail(opportunity_id)
        if detail:
            return detail
    data = await search_opportunities(number or title, max_results=3)
    results = data["results"]
    for r in results:
        if (number and r["opportunity_number"] == number) or r["opportunity_title"].lower() == title.lower():
            return await get_opportunity_detail(r["opportunity_id"]) or r
    return results[0] if results else None


async def get_grant_detail(
    opportunity_title: str,
    tool_context: ToolContext,
    opportunity_number: str = "",
    opportunity_id: str = "",
) -> dict:
    """Get detailed information about one specific grant opportunity. Use when the user wants to learn more about a particular grant, asks "tell me more about...", or wants full details or requirements.

    Args:
        opportunity_title: The title of the grant to look up.
        tool_context: The tool context for accessing state.
        opportunity_number: The opportunity/NOFO number if known.
        opportunity_id: The UUID of the opportunity if known (fastest).
    """
    try:
        detail = await _resolve_grant(opportunity_title, opportunity_number, opportunity_id)
    except Exception as e:
        return _error(f"Grant lookup failed: {e}")
    if not detail:
        return _empty(f"Could not find a grant matching '{opportunity_title}'.")

    srcs = [S.grant_record(detail, "Every field on this page")] + [
        {**S.grant_record({"opportunity_id": a["download_path"], "opportunity_title": a["file_name"],
                           "fetched_at": detail.get("fetched_at")}, "Official attachment (NOFO / guidance)"),
         "url": a["download_path"], "detail": a.get("file_description") or "Attachment"}
        for a in (detail.get("attachments") or [])[:6] if a.get("download_path")]
    _show(tool_context, "grant_detail", detail.get("opportunity_title", opportunity_title), grant_detail=detail,
          sources=srcs)
    return _ok("Details are on the dashboard.", **_compact(detail),
               eligibility=(detail.get("applicant_eligibility_description") or "")[:400],
               cost_sharing=detail.get("is_cost_sharing"))


# ──────────────────────────────────────────────
# Tool 4: Stats — funding landscape overview with charts
# ──────────────────────────────────────────────

async def get_grant_stats(
    query: str,
    tool_context: ToolContext,
    agency: str = "",
    funding_category: str = "",
) -> dict:
    """Get an overview of the grants landscape for a topic: counts by agency, category, status, and funding totals. Use for "how many grants", "overview of", "landscape", "breakdown", "statistics".

    Args:
        query: The topic or field to analyze (e.g. "climate", "health", "AI").
        tool_context: The tool context for accessing state.
        agency: Optional agency filter (e.g. "NSF").
        funding_category: Optional category filter (e.g. "education").
    """
    try:
        data = await search_opportunities(query, max_results=25, agency=agency or None,
                                          funding_category=funding_category or None, include_facets=True)
    except Exception as e:
        return _error(f"Grants.gov stats query failed: {e}")

    results = data["results"]
    facets = data.get("facets", {})
    total = data.get("total_results", len(results))
    if not results:
        return _empty(f"No open grants found for '{query}'.")

    total_funding = sum(r.get("estimated_total_program_funding") or 0 for r in results)
    award_floors = [r["award_floor"] for r in results if r.get("award_floor")]
    award_ceilings = [r["award_ceiling"] for r in results if r.get("award_ceiling")]
    total_awards = sum(r.get("expected_number_of_awards") or 0 for r in results)

    # Bucket grants by award size so the dashboard can show a distribution chart
    funding_ranges = {"Under $100K": 0, "$100K - $500K": 0, "$500K - $1M": 0, "$1M - $10M": 0, "Over $10M": 0}
    for r in results:
        ceiling = r.get("award_ceiling")
        if ceiling is None:
            continue
        if ceiling < 100_000:
            funding_ranges["Under $100K"] += 1
        elif ceiling < 500_000:
            funding_ranges["$100K - $500K"] += 1
        elif ceiling < 1_000_000:
            funding_ranges["$500K - $1M"] += 1
        elif ceiling < 10_000_000:
            funding_ranges["$1M - $10M"] += 1
        else:
            funding_ranges["Over $10M"] += 1

    stats = {
        "total_results": total,
        "total_estimated_funding": total_funding,
        "total_expected_awards": total_awards,
        "min_award": min(award_floors) if award_floors else None,
        "max_award": max(award_ceilings) if award_ceilings else None,
        "funding_ranges": {k: v for k, v in funding_ranges.items() if v > 0},
        "by_agency": facets.get("agency", {}),
        "by_category": facets.get("funding_category", {}),
        "by_status": facets.get("opportunity_status", {}),
        "by_applicant_type": facets.get("applicant_type", {}),
        "by_instrument": facets.get("funding_instrument", {}),
        "sample_grants": [{"title": r["opportunity_title"], "agency": r["agency_name"],
                           "ceiling": r.get("award_ceiling")} for r in results[:5]],
    }
    _show(tool_context, "grant_stats", query, grant_stats=stats, grants_data=results, sources=[S.grants_search(
        query, data, f"Agency, category and status counts cover all matches; funding totals, award range and "
        f"size buckets are computed from the top {len(results)} listings", sampled=len(results),
        agency=agency, funding_category=funding_category)])
    return _ok("Charts are on the dashboard.", total=total, total_funding=total_funding,
               top_agencies=dict(list(facets.get("agency", {}).items())[:5]))


# ──────────────────────────────────────────────
# Tool 5: Deadlines — what's closing soon
# ──────────────────────────────────────────────

async def get_deadlines(
    tool_context: ToolContext,
    query: str = "",
    agency: str = "",
    days_ahead: int = 90,
) -> dict:
    """Find grants with upcoming deadlines, closest first. Use for "deadlines", "closing soon", "due soon", "urgent", "expiring".

    Args:
        tool_context: The tool context for accessing state.
        query: Optional topic filter (e.g. "education", "health").
        agency: Optional agency filter (e.g. "NSF").
        days_ahead: How many days ahead to look (default 90).
    """
    start_date = datetime.now().strftime("%Y-%m-%d")
    end_date = (datetime.now() + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    try:
        data = await search_opportunities(query or "grants", max_results=20, agency=agency or None,
                                          sort_by="close_date", sort_direction="ascending",
                                          close_date_start=start_date, close_date_end=end_date)
    except Exception as e:
        return _error(f"Grants.gov deadline query failed: {e}")

    with_dates = [r for r in data["results"] if r.get("close_date")]
    _show(tool_context, "deadline_tracker", query or "Upcoming Deadlines",
          deadline_grants=with_dates, deadline_days=days_ahead, sources=[S.grants_search(
              query or "grants", data, f"Grants closing {start_date} to {end_date}, soonest first",
              sampled=len(with_dates), agency=agency,
              title=f"Grants.gov: {query + ' grants' if query else 'grants'} closing in the next {days_ahead} days")])
    if not with_dates:
        return _empty(f"No grants with deadlines in the next {days_ahead} days.")
    return _ok("Deadlines are on the dashboard.", count=len(with_dates), days_ahead=days_ahead,
               upcoming=[_compact(r) for r in with_dates[:5]])


# ──────────────────────────────────────────────
# Tool 6: Agency Overview — "what does NSF offer?"
# ──────────────────────────────────────────────

async def get_agency_overview(agency: str, tool_context: ToolContext) -> dict:
    """Get an overview of a specific agency's grant offerings. Use for "what does NSF offer?", "tell me about NIH grants", "DOE funding programs".

    Args:
        agency: The agency code (e.g. "NSF", "NIH", "DOE", "EPA", "USAID", "DOC", "ED", "HHS", "DOD", "USDA").
        tool_context: The tool context for accessing state.
    """
    try:
        data = await search_opportunities("grants", max_results=20, agency=agency, include_facets=True)
    except Exception as e:
        return _error(f"Grants.gov agency query failed: {e}")

    results = data["results"]
    if not results:
        return _empty(f"No open grants found for agency '{agency}'. Check the agency code.")
    facets = data.get("facets", {})
    total = data.get("total_results", len(results))
    total_funding = sum(r.get("estimated_total_program_funding") or 0 for r in results)

    by_category: dict[str, list] = {}
    for r in results:
        cats = r.get("funding_categories", [])
        cat = cats[0].replace("_", " ").title() if cats else "Other"
        by_category.setdefault(cat, []).append({
            "title": r["opportunity_title"], "number": r["opportunity_number"],
            "status": r["opportunity_status"], "ceiling": r.get("award_ceiling"), "close_date": r.get("close_date"),
        })

    agency_display = results[0].get("top_level_agency_name") or results[0].get("agency_name", agency.upper())
    overview = {
        "agency_code": agency.upper(),
        "agency_name": agency_display,
        "total_grants": total,
        "total_estimated_funding": total_funding,
        "grants_by_category": by_category,
        "status_breakdown": facets.get("opportunity_status", {}),
        "applicant_types": facets.get("applicant_type", {}),
        "funding_categories": facets.get("funding_category", {}),
        "sample_grants": results[:10],
    }
    _show(tool_context, "agency_overview", agency_display, agency_data=overview, grants_data=results,
          sources=[S.grants_search("grants", data, f"Counts cover all {agency.upper()} matches; the funding total "
                                   f"is summed from the top {len(results)} listings", sampled=len(results),
                                   agency=agency, title=f"Grants.gov: all open {agency.upper()} opportunities")])
    return _ok("Agency profile is on the dashboard.", agency=agency_display, total_grants=total,
               total_funding=total_funding, categories=list(by_category.keys())[:5])


# ──────────────────────────────────────────────
# Tool 7: Eligibility — "I'm a nonprofit, what can I apply for?"
# ──────────────────────────────────────────────

async def get_eligible_grants(
    applicant_type: str,
    tool_context: ToolContext,
    query: str = "",
    funding_category: str = "",
) -> dict:
    """Find grants a specific type of applicant is eligible for. Use for "I'm a nonprofit", "grants for small businesses", "what can universities apply for?".

    Args:
        applicant_type: The type of applicant. Values: "individuals", "nonprofits_non_higher_education_with_501c3", "nonprofits_non_higher_education_without_501c3", "small_businesses", "for_profit_organizations_other_than_small_businesses", "state_governments", "county_governments", "city_or_township_governments", "public_and_state_institutions_of_higher_education", "private_institutions_of_higher_education", "federally_recognized_native_american_tribal_governments", "other_native_american_tribal_organizations", "independent_school_districts", "special_district_governments", "unrestricted".
        tool_context: The tool context for accessing state.
        query: Optional topic filter (e.g. "education", "technology").
        funding_category: Optional category filter.
    """
    try:
        data = await search_opportunities(query or "grants", max_results=15, applicant_type=applicant_type or None,
                                          funding_category=funding_category or None, include_facets=True)
    except Exception as e:
        return _error(f"Grants.gov eligibility query failed: {e}")

    results = data["results"]
    facets = data.get("facets", {})
    total = data.get("total_results", len(results))
    type_display = applicant_type.replace("_", " ").title()
    if not results:
        return _empty(f"No open grants found for {type_display}.")

    eligibility = {
        "applicant_type": applicant_type,
        "applicant_type_display": type_display,
        "total_eligible": total,
        "grants": results,
        "by_agency": facets.get("agency", {}),
        "by_category": facets.get("funding_category", {}),
        "cost_sharing_breakdown": facets.get("is_cost_sharing", {}),
    }
    _show(tool_context, "eligibility_match", f"Grants for {type_display}", eligibility_data=eligibility,
          sources=[S.grants_search(query or "grants", data, f"Grants open to {type_display}",
                                   applicant_type=applicant_type, funding_category=funding_category,
                                   title="" if query else f"Grants.gov: open opportunities for {type_display}")])
    return _ok("Eligible grants are on the dashboard.", applicant_type=type_display, total_eligible=total,
               top_agencies=dict(list(facets.get("agency", {}).items())[:5]),
               top_grants=[_compact(r) for r in results[:3]])


# ──────────────────────────────────────────────
# Tool 8: Compare — side-by-side, rendered as A2UI
# ──────────────────────────────────────────────

async def compare_grants(grant_titles: list[str], tool_context: ToolContext) -> dict:
    """Compare 2-4 grant opportunities side by side (award size, deadline, eligibility, cost sharing). Use for "compare these", "which is better", "X vs Y".

    Args:
        grant_titles: 2 to 4 grant titles or opportunity numbers to compare, taken from earlier results.
        tool_context: The tool context for accessing state.
    """
    grant_titles = [t for t in grant_titles if t and t.strip()][:4]
    if len(grant_titles) < 2:
        return _error("Need at least two grants to compare.", retryable=False)

    known = {r["opportunity_title"].lower(): r for r in _all_known_grants(tool_context)}

    async def resolve(t: str):
        hit = known.get(t.lower())
        if hit and hit.get("opportunity_id"):
            return await get_opportunity_detail(hit["opportunity_id"]) or hit
        return await _resolve_grant(t, number=t if any(c.isdigit() for c in t) else "")

    try:
        grants = [g for g in await asyncio.gather(*(resolve(t) for t in grant_titles)) if g]
    except Exception as e:
        return _error(f"Comparison lookup failed: {e}")
    if len(grants) < 2:
        return _empty("Could not find enough of those grants to compare.")

    _show_a2ui(tool_context, a2ui_builder.build_comparison(f"compare-{uuid.uuid4().hex[:6]}", grants),
               "Comparison", sources=[S.grant_record(g, "A column in the comparison") for g in grants])
    return _ok("Comparison is on the dashboard. Highlight the 1-2 most important differences.",
               grants=[_compact(g) | {"floor": g.get("award_floor"), "cost_sharing": g.get("is_cost_sharing"),
                                      "total_funding": g.get("estimated_total_program_funding")} for g in grants])


# ──────────────────────────────────────────────
# Tool 9: Compose — agent-designed dashboard (A2UI)
# ──────────────────────────────────────────────

class Widget(BaseModel):
    """One block on an agent-composed dashboard."""
    type: str = Field(description='One of: "metric", "bar_chart", "callout", "grant_list", "checklist", "text".')
    label: Optional[str] = Field(default=None, description="metric: the label, e.g. 'Open NSF grants'.")
    value: Optional[str] = Field(default=None, description="metric: the headline value, e.g. '42' or '$3.2M'.")
    caption: Optional[str] = Field(default=None, description="metric: small caption under the value.")
    title: Optional[str] = Field(default=None, description="Title for bar_chart, callout, grant_list, checklist.")
    text: Optional[str] = Field(default=None, description="callout/text: the body text (simple Markdown allowed).")
    tone: Optional[str] = Field(default=None, description='callout: "info", "success", or "warning".')
    data: Optional[dict[str, float]] = Field(default=None, description="bar_chart: {label: number}.")
    items: Optional[list[str]] = Field(default=None, description="checklist: the items.")
    source: Optional[str] = Field(default=None, description='grant_list: "last_search", "shortlist", "deadlines", or "eligible".')
    limit: Optional[int] = Field(default=None, description="grant_list: max cards (default 4).")


def _all_known_grants(tool_context: ToolContext) -> list[dict]:
    s = tool_context.state
    out = list(s.get("grants_data") or []) + list(s.get("deadline_grants") or [])
    out += list((s.get("eligibility_data") or {}).get("grants") or [])
    out += list(s.get("user:shortlist") or [])
    if s.get("grant_detail"):
        out.append(s.get("grant_detail"))
    return out


def _grant_sources(tool_context: ToolContext) -> dict[str, list[dict]]:
    s = tool_context.state
    return {
        "last_search": list(s.get("grants_data") or []),
        "shortlist": list(s.get("user:shortlist") or []),
        "deadlines": list(s.get("deadline_grants") or []),
        "eligible": list((s.get("eligibility_data") or {}).get("grants") or []),
    }


async def compose_dashboard(title: str, widgets: list[Widget], tool_context: ToolContext, subtitle: str = "") -> dict:
    """Design a custom dashboard for the user from building blocks: metrics, bar charts, callouts, checklists, text, and grant lists. Use for briefings, funding strategies, application readiness checklists, summaries of what you found, or any view the fixed dashboards don't cover. Grant lists pull from data you already fetched (last_search, shortlist, deadlines, eligible), so call a search tool first if needed.

    Args:
        title: Dashboard title.
        widgets: Ordered list of blocks. Consecutive metrics are laid out side by side.
        tool_context: The tool context for accessing state.
        subtitle: Optional one-line subtitle.
    """
    raw = [w.model_dump(exclude_none=True) if isinstance(w, BaseModel) else dict(w) for w in widgets or []]
    raw = [w | {"type": (w.get("type") or "").lower()} for w in raw]
    raw = [w for w in raw if w["type"] in a2ui_builder.WIDGET_TYPES]
    if not raw:
        return _error("No valid widgets. Use types: " + ", ".join(a2ui_builder.WIDGET_TYPES), retryable=True)
    pools = _grant_sources(tool_context)
    messages = a2ui_builder.build_dashboard(f"dash-{uuid.uuid4().hex[:6]}", title, subtitle, raw, pools)
    # Grant cards cite their listings; everything the model wrote is labelled as AI-written,
    # and the screen inherits the sources of the data it was built from
    cards = [S.grant_record(g, "A grant card on this dashboard") for w in raw if w["type"] == "grant_list"
             for g in pools.get(w.get("source") or "last_search", [])[: w.get("limit") or 4]]
    authored = [w["type"] for w in raw if w["type"] in ("metric", "bar_chart", "callout", "checklist", "text")]
    srcs = S.merge(cards, tool_context.state.get("sources") or [],
                   [S.ai_generated("Headline numbers, charts and wording (" + ", ".join(sorted(set(authored))) + ")")]
                   if authored else [])
    _show_a2ui(tool_context, messages, title, sources=srcs)
    return _ok("Dashboard rendered. Walk the user through it briefly.", widgets=len(raw))


# ──────────────────────────────────────────────
# Tools 10-12: Shortlist — persists across sessions (user: state)
# ──────────────────────────────────────────────

def _publish_shortlist(tool_context: ToolContext, shortlist: list[dict]) -> None:
    ui_bus.publish(_session_id(tool_context), {"type": "shortlist", "shortlist": shortlist})


async def save_to_shortlist(
    opportunity_title: str,
    tool_context: ToolContext,
    opportunity_id: str = "",
    opportunity_number: str = "",
    agency_name: str = "",
    note: str = "",
) -> dict:
    """Save a grant to the user's personal shortlist, which is remembered across sessions. Use when the user says "save this", "bookmark", "add to my list", "remember this one".

    Args:
        opportunity_title: The grant title.
        tool_context: The tool context for accessing state.
        opportunity_id: The opportunity UUID if known.
        opportunity_number: The opportunity number if known.
        agency_name: The agency name if known.
        note: Optional short note from the user (e.g. "good fit for the robotics lab").
    """
    shortlist = list(tool_context.state.get("user:shortlist") or [])
    if any(g["opportunity_title"].lower() == opportunity_title.lower() for g in shortlist):
        return _ok("Already on the shortlist.", count=len(shortlist))

    known = {g["opportunity_title"].lower(): g for g in _all_known_grants(tool_context)}
    base = known.get(opportunity_title.lower(), {})
    entry = {
        "opportunity_title": opportunity_title,
        "opportunity_id": opportunity_id or base.get("opportunity_id", ""),
        "opportunity_number": opportunity_number or base.get("opportunity_number", ""),
        "agency_name": agency_name or base.get("agency_name", ""),
        "award_floor": base.get("award_floor"),
        "award_ceiling": base.get("award_ceiling"),
        "close_date": base.get("close_date"),
        "opportunity_status": base.get("opportunity_status", ""),
        "additional_info_url": base.get("additional_info_url"),
        "source_url": base.get("source_url"),
        "fetched_at": base.get("fetched_at"),
        "note": note,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
    }
    shortlist.append(entry)
    tool_context.state["user:shortlist"] = shortlist
    _publish_shortlist(tool_context, shortlist)
    return _ok("Saved. Confirm in a few words.", count=len(shortlist))


async def remove_from_shortlist(opportunity_title: str, tool_context: ToolContext) -> dict:
    """Remove a grant from the user's shortlist.

    Args:
        opportunity_title: The grant title to remove.
        tool_context: The tool context for accessing state.
    """
    shortlist = list(tool_context.state.get("user:shortlist") or [])
    kept = [g for g in shortlist if opportunity_title.lower() not in g["opportunity_title"].lower()]
    if len(kept) == len(shortlist):
        return _empty(f"'{opportunity_title}' is not on the shortlist.")
    tool_context.state["user:shortlist"] = kept
    _publish_shortlist(tool_context, kept)
    return _ok("Removed.", count=len(kept))


async def show_shortlist(tool_context: ToolContext) -> dict:
    """Show the user's saved shortlist of grants on the dashboard, with upcoming deadlines. Use for "my shortlist", "what did I save", "my saved grants".

    Args:
        tool_context: The tool context for accessing state.
    """
    shortlist = list(tool_context.state.get("user:shortlist") or [])
    if not shortlist:
        return _empty("The shortlist is empty.")
    soonest = sorted([g for g in shortlist if g.get("close_date")], key=lambda g: g["close_date"])
    widgets = [
        {"type": "metric", "label": "Saved grants", "value": str(len(shortlist))},
        {"type": "metric", "label": "Next deadline", "value": soonest[0]["close_date"] if soonest else "—",
         "caption": soonest[0]["opportunity_title"][:60] if soonest else None},
        {"type": "grant_list", "title": "Your shortlist", "source": "shortlist", "limit": 12},
    ]
    messages = a2ui_builder.build_dashboard(f"shortlist-{uuid.uuid4().hex[:6]}", "Your Shortlist",
                                            "Saved across sessions", widgets, _grant_sources(tool_context))
    _show_a2ui(tool_context, messages, "Your Shortlist", sources=[
        S.grant_record(g, f"Saved {g.get('saved_at', '')[:10]}".strip()) for g in shortlist])
    return _ok("Shortlist is on the dashboard.", grants=[g["opportunity_title"] for g in shortlist])


# ──────────────────────────────────────────────
# Tool 13: Profile memory — personalizes every future session
# ──────────────────────────────────────────────

async def remember_user_profile(
    tool_context: ToolContext,
    organization_type: str = "",
    organization_name: str = "",
    research_interests: str = "",
    location: str = "",
    career_stage: str = "",
) -> dict:
    """Remember facts about the user for personalized recommendations in this and future sessions. Call this as soon as the user mentions their organization, type of organization, research area, location, or career stage — without asking permission.

    Args:
        tool_context: The tool context for accessing state.
        organization_type: e.g. "public university", "501c3 nonprofit", "small business", "tribal government".
        organization_name: e.g. "University at Buffalo".
        research_interests: e.g. "robotics for agriculture, computer vision".
        location: e.g. "Buffalo, NY".
        career_stage: e.g. "early-career faculty", "postdoc", "program director".
    """
    profile = dict(tool_context.state.get("user:profile") or {})
    updates = {k: v for k, v in dict(organization_type=organization_type, organization_name=organization_name,
                                     research_interests=research_interests, location=location,
                                     career_stage=career_stage).items() if v}
    if not updates:
        return _error("Nothing to remember.", retryable=False)
    profile.update(updates)
    tool_context.state["user:profile"] = profile
    ui_bus.publish(_session_id(tool_context), {"type": "profile", "profile": profile})
    return _ok("Remembered. Do not mention this unless asked; just continue helping.", profile=profile)


# ──────────────────────────────────────────────
# Tool activity → UI chips ("Searching Grants.gov…")
# ──────────────────────────────────────────────

TOOL_LABELS = {
    "search_grants": "Searching Grants.gov",
    "draft_grant_response": "Writing proposal draft",
    "get_grant_detail": "Pulling grant details",
    "get_grant_stats": "Analyzing funding landscape",
    "get_deadlines": "Checking deadlines",
    "get_agency_overview": "Profiling agency",
    "get_eligible_grants": "Matching eligibility",
    "compare_grants": "Comparing grants",
    "compose_dashboard": "Designing dashboard",
    "save_to_shortlist": "Saving to shortlist",
    "remove_from_shortlist": "Updating shortlist",
    "show_shortlist": "Opening shortlist",
    "remember_user_profile": "Updating your profile",
    "google_search": "Searching the web",
}


async def before_tool(tool, args, tool_context: ToolContext):
    ui_bus.publish(_session_id(tool_context), {
        "type": "tool_start", "id": tool_context.function_call_id, "name": tool.name,
        "label": TOOL_LABELS.get(tool.name, tool.name), "args": _safe_args(args),
    })
    return None


async def after_tool(tool, args, tool_context: ToolContext, tool_response):
    status = tool_response.get("status", "ok") if isinstance(tool_response, dict) else "ok"
    ui_bus.publish(_session_id(tool_context), {
        "type": "tool_end", "id": tool_context.function_call_id, "name": tool.name, "status": status,
    })
    return None


def _safe_args(args: dict) -> dict:
    try:
        return json.loads(json.dumps(args, default=str))
    except Exception:
        return {}


ALL_TOOLS = [
    search_grants, draft_grant_response, get_grant_detail, get_grant_stats, get_deadlines,
    get_agency_overview, get_eligible_grants, compare_grants, compose_dashboard,
    save_to_shortlist, remove_from_shortlist, show_shortlist, remember_user_profile,
]
