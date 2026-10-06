"""
Citations — every dashboard screen carries a `sources` list saying where its
content came from. The UI shows them as card footers, a per-screen Sources
panel, numbered chips in chat / voice captions, and footnotes in drafts.

A source is a plain dict:
    id          stable id (same url → same id), used to dedupe and number
    kind        grants_gov | web | your_input | template | ai_generated
    title       short human title
    url         link to the original (optional)
    detail      one line of context, e.g. "25 of 143 open opportunities"
    fetched_at  ISO time the data was retrieved (optional)
    supports    what on the screen this source backs up (optional)
"""

from __future__ import annotations

import hashlib

from grants_api import listing_url, now_iso, search_url


def _sid(*parts: str) -> str:
    return "src-" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def grants_search(query: str, data: dict, supports: str, sampled: int | None = None, title: str = "", **filters) -> dict:
    """The Grants.gov query behind a screen. `sampled` = how many records the numbers were computed from."""
    total = data.get("total_results") or len(data.get("results", []))
    shown = sampled if sampled is not None else len(data.get("results", []))
    active = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in filters.items() if v)
    detail = f"{shown} of {total:,} open opportunities" + (f" · {active}" if active else "")
    url = search_url(query, **{k: v for k, v in filters.items() if k in ("agency",) and v})
    return {"id": _sid("gg-search", query, active), "kind": "grants_gov",
            "title": title or f"Grants.gov search: “{query}”", "url": url, "detail": detail,
            "fetched_at": data.get("fetched_at") or now_iso(), "supports": supports}


def grant_record(g: dict, supports: str = "") -> dict:
    """One opportunity listing."""
    oid = g.get("opportunity_id", "")
    number = g.get("opportunity_number") or ""
    return {"id": _sid("gg-opp", oid or number or g.get("opportunity_title", "")), "kind": "grants_gov",
            "title": g.get("opportunity_title") or "Grant listing",
            "url": g.get("source_url") or listing_url(oid),
            "detail": " · ".join(x for x in (number, g.get("agency_name")) if x),
            "fetched_at": g.get("fetched_at") or now_iso(), "supports": supports}


def web(title: str, uri: str, supports: str = "") -> dict:
    return {"id": _sid("web", uri), "kind": "web", "title": title or uri, "url": uri,
            "detail": _domain(title, uri), "fetched_at": now_iso(), "supports": supports}


def your_input(title: str, detail: str, supports: str) -> dict:
    return {"id": _sid("you", title, detail[:60]), "kind": "your_input", "title": title,
            "detail": detail[:160], "supports": supports}


def template(title: str, supports: str) -> dict:
    return {"id": _sid("tpl", title), "kind": "template", "title": title, "supports": supports}


def ai_generated(supports: str) -> dict:
    return {"id": _sid("ai", supports), "kind": "ai_generated", "title": "Written by the AI advisor",
            "detail": "Review before relying on it", "supports": supports}


def _domain(title: str, uri: str) -> str:
    # Grounding chunk titles are usually the domain (e.g. "nsf.gov"); uris are redirect links
    if title and "." in title and " " not in title:
        return title
    from urllib.parse import urlparse
    return urlparse(uri).netloc


def from_grounding(gm) -> tuple[list[dict], list[dict], str]:
    """Gemini grounding_metadata → (web sources, supports [{text, source_ids}], search entry point html)."""
    if not gm or not getattr(gm, "grounding_chunks", None):
        return [], [], ""
    srcs = [web(c.web.title or "", c.web.uri or "") for c in gm.grounding_chunks if c.web and c.web.uri]
    supports = []
    for s in getattr(gm, "grounding_supports", None) or []:
        idx = [i for i in (s.grounding_chunk_indices or []) if i < len(srcs)]
        if s.segment and s.segment.text and idx:
            supports.append({"text": s.segment.text, "source_ids": [srcs[i]["id"] for i in idx]})
    sep = getattr(gm, "search_entry_point", None)
    html = (sep.rendered_content or "") if sep else ""
    return merge(srcs), supports, html


def merge(*lists: list[dict]) -> list[dict]:
    seen, out = set(), []
    for lst in lists:
        for s in lst or []:
            if s and s["id"] not in seen:
                seen.add(s["id"])
                out.append(s)
    return out
