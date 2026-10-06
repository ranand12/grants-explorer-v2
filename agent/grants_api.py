"""
Async wrapper for the Simpler Grants API (https://api.simpler.grants.gov).

All the grant data comes from here — search, filters, facets, and detail lookups.
The API is free and doesn't require OAuth, just an API key in the header.

v2: async + a shared connection pool, so tool calls don't block the Live API
event loop (Gemini 3.8 Live keeps talking while tools run).
"""

import asyncio
import os
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx

API_BASE = "https://api.simpler.grants.gov/v1"
SITE_BASE = "https://simpler.grants.gov"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def listing_url(opportunity_id: str) -> str:
    return f"{SITE_BASE}/opportunity/{opportunity_id}" if opportunity_id else SITE_BASE


def search_url(query: str, **filters) -> str:
    """Public search page for the same query, so users can reproduce what the agent saw."""
    params = {"query": query} | {k: v for k, v in filters.items() if v}
    return f"{SITE_BASE}/search?{urlencode(params)}"

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=API_BASE,
            timeout=httpx.Timeout(20.0, connect=5.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-API-Key": os.environ.get("SIMPLER_GRANTS_AI", ""),
    }


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    """One retry on transient failures (timeouts, 5xx, 429)."""
    for attempt in range(2):
        try:
            resp = await _get_client().request(method, path, headers=_headers(), **kwargs)
            if resp.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                await asyncio.sleep(0.6)
                continue
            resp.raise_for_status()
            return resp
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == 1:
                raise
            await asyncio.sleep(0.6)
    raise RuntimeError("unreachable")


def _parse_opportunity(opp: dict, fetched_at: str = "") -> dict:
    """Flatten the nested API response into a clean dict we can use everywhere."""
    summary = opp.get("summary") or {}
    return {
        # Provenance: every record carries where and when it came from
        "source_url": listing_url(opp.get("opportunity_id", "")),
        "fetched_at": fetched_at or now_iso(),
        "opportunity_id": opp.get("opportunity_id", ""),
        "opportunity_title": opp.get("opportunity_title", "Untitled"),
        "agency_name": opp.get("agency_name") or opp.get("top_level_agency_name") or "Unknown Agency",
        "agency_code": opp.get("agency_code", ""),
        "top_level_agency_name": opp.get("top_level_agency_name", ""),
        "opportunity_number": opp.get("opportunity_number", ""),
        "opportunity_status": opp.get("opportunity_status", ""),
        "award_floor": summary.get("award_floor"),
        "award_ceiling": summary.get("award_ceiling"),
        "estimated_total_program_funding": summary.get("estimated_total_program_funding"),
        "expected_number_of_awards": summary.get("expected_number_of_awards"),
        "close_date": summary.get("close_date"),
        "post_date": summary.get("post_date"),
        "description": summary.get("summary_description", ""),
        "applicant_eligibility_description": summary.get("applicant_eligibility_description", ""),
        "funding_categories": summary.get("funding_categories", []),
        "funding_instruments": summary.get("funding_instruments", []),
        "applicant_types": summary.get("applicant_types", []),
        "additional_info_url": summary.get("additional_info_url"),
        "agency_email": summary.get("agency_email_address"),
        "agency_contact_description": summary.get("agency_contact_description", ""),
        "is_cost_sharing": summary.get("is_cost_sharing"),
        "is_forecast": summary.get("is_forecast", False),
    }


def _parse_facets(raw_facets: dict) -> dict:
    """Turn the API's facet_counts into simple {name: {value: count}} dicts."""
    facets = {}
    for facet_name, facet_data in raw_facets.items():
        if isinstance(facet_data, dict):
            counts = {}
            for value, count in facet_data.items():
                if isinstance(count, (int, float)) and count > 0:
                    counts[value] = int(count)
            if counts:
                facets[facet_name] = counts
    return facets


# Grants.gov filters on top-level agency only; people (and the model) say "NIH",
# not "HHS". Map common sub-agencies to (top-level code, agency_code prefix).
SUB_AGENCIES = {
    "NIH": ("HHS", "HHS-NIH"), "CDC": ("HHS", "HHS-CDC"), "HRSA": ("HHS", "HHS-HRSA"),
    "SAMHSA": ("HHS", "HHS-SAMHS"), "ACF": ("HHS", "HHS-ACF"), "FDA": ("HHS", "HHS-FDA"),
    "AHRQ": ("HHS", "HHS-AHRQ"), "ACL": ("HHS", "HHS-ACL"), "IHS": ("HHS", "HHS-IHS"),
    "NOAA": ("DOC", "DOC-NOAA"), "NIST": ("DOC", "DOC-NIST"), "EDA": ("DOC", "DOC-EDA"),
    "NIFA": ("USDA", "USDA-NIFA"), "DARPA": ("DOD", "DOD-DARPA"),
}


def _resolve_agencies(agency: str) -> tuple[list[str], list[str]]:
    tops, prefixes = [], []
    for a in (x.strip() for x in agency.split(",") if x.strip()):
        top, prefix = SUB_AGENCIES.get(a.upper(), (a, None))
        tops.append(top)
        if prefix:
            prefixes.append(prefix)
    return sorted(set(tops)), prefixes


async def search_opportunities(
    query: str,
    max_results: int = 10,
    agency: str | None = None,
    applicant_type: str | None = None,
    funding_instrument: str | None = None,
    funding_category: str | None = None,
    award_floor: int | None = None,
    award_ceiling: int | None = None,
    sort_by: str = "relevancy",
    sort_direction: str = "descending",
    close_date_start: str | None = None,
    close_date_end: str | None = None,
    include_facets: bool = False,
) -> dict:
    """Search for grant opportunities. Returns {"results": [...], "facets": {...}}."""

    # Always filter to posted/forecasted — no point showing closed grants
    filters: dict = {
        "opportunity_status": {"one_of": ["posted", "forecasted"]},
    }

    # Build optional filters — each one uses the API's filter syntax
    prefixes: list[str] = []
    if agency:
        tops, prefixes = _resolve_agencies(agency)
        filters["top_level_agency"] = {"one_of": tops}
    if applicant_type:
        filters["applicant_type"] = {"one_of": [a.strip() for a in applicant_type.split(",")]}
    if funding_instrument:
        filters["funding_instrument"] = {"one_of": [a.strip() for a in funding_instrument.split(",")]}
    if funding_category:
        filters["funding_category"] = {"one_of": [a.strip() for a in funding_category.split(",")]}
    if award_floor is not None:
        filters["award_floor"] = {"min": award_floor}
    if award_ceiling is not None:
        filters["award_ceiling"] = {"max": award_ceiling}
    if close_date_start or close_date_end:
        cd_filter = {}
        if close_date_start:
            cd_filter["start_date"] = close_date_start
        if close_date_end:
            cd_filter["end_date"] = close_date_end
        filters["close_date"] = cd_filter

    body = {
        "query": query,
        "filters": filters,
        "pagination": {
            "page_offset": 1,
            # Over-fetch when we have to post-filter to a sub-agency
            "page_size": max_results * 4 if prefixes else max_results,
            "sort_order": [
                {"order_by": sort_by, "sort_direction": sort_direction}
            ],
        },
    }

    resp = await _request("POST", "/opportunities/search", json=body)
    data = resp.json()

    fetched_at = now_iso()
    results = [_parse_opportunity(opp, fetched_at) for opp in data.get("data", [])]
    if prefixes:
        results = [r for r in results if any(r["agency_code"].startswith(p) for p in prefixes)][:max_results]

    output: dict = {"results": results, "fetched_at": fetched_at,
                    "total_results": data.get("pagination_info", {}).get("total_records", len(results))}
    if include_facets:
        output["facets"] = _parse_facets(data.get("facet_counts", {}))

    return output


async def get_opportunity_detail(opportunity_id: str) -> dict | None:
    """Fetch full details for a single opportunity by ID. Returns None on any error."""
    try:
        resp = await _request("GET", f"/opportunities/{opportunity_id}", timeout=15.0)
        data = resp.json().get("data", {})
        opp = _parse_opportunity(data)

        # Include file attachments if the grant has any (NOFOs, guidelines, etc.)
        attachments = data.get("attachments", [])
        if attachments:
            opp["attachments"] = [
                {
                    "file_name": a.get("file_name", ""),
                    "file_description": a.get("file_description", ""),
                    "download_path": a.get("download_path", ""),
                }
                for a in attachments
            ]
        return opp
    except Exception:
        return None
