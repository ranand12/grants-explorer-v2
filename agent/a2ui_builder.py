"""
A2UI v0.9 message builder.

The agent picks *what* to show (typed widgets); this module turns that into
standard A2UI v0.9 server-to-client messages (createSurface / updateComponents)
that the frontend renders with the official @a2ui/react renderer.

Why server-side generation instead of letting the model emit raw A2UI JSON:
a live voice model producing deeply nested component trees in a function call
is slow and fragile. Typed widgets → deterministic A2UI keeps the wire format
standard while keeping voice latency low.

The catalog = the A2UI basic catalog + a few grants-specific components
(Metric, BarChart, GrantCard, Callout, Checklist, CompareTable). The frontend
registers the same component names under CATALOG_ID.
"""

from __future__ import annotations

import itertools
from typing import Any, Iterable

A2UI_VERSION = "v0.9"
CATALOG_ID = "https://grants-explorer.dev/a2ui/catalogs/grants/v1"

WIDGET_TYPES = ("metric", "bar_chart", "callout", "grant_list", "checklist", "text")


class _Tree:
    """Accumulates a flat A2UI component list (v0.9 uses id references, not nesting)."""

    def __init__(self, prefix: str):
        self.components: list[dict] = []
        self._ids = itertools.count(1)
        self._prefix = prefix

    def add(self, component: str, cid: str | None = None, **props: Any) -> str:
        cid = cid or f"{self._prefix}{next(self._ids)}"
        self.components.append({"id": cid, "component": component, **{k: v for k, v in props.items() if v is not None}})
        return cid

    def text(self, text: str, variant: str = "body") -> str:
        return self.add("Text", text=text, variant=variant)


def _action(name: str, **context: Any) -> dict:
    return {"event": {"name": name, "context": {k: v for k, v in context.items() if v not in (None, "")}}}


def grant_card(tree: _Tree, g: dict) -> str:
    """A grant card with Details / Save / Draft actions that flow back to the agent."""
    title = g.get("opportunity_title") or g.get("title") or "Untitled"
    ctx = dict(
        opportunity_title=title,
        opportunity_id=g.get("opportunity_id", ""),
        opportunity_number=g.get("opportunity_number") or g.get("number", ""),
        agency_name=g.get("agency_name") or g.get("agency", ""),
    )
    return tree.add(
        "GrantCard",
        title=title,
        agency=ctx["agency_name"],
        number=ctx["opportunity_number"],
        status=g.get("opportunity_status") or g.get("status") or "",
        floor=g.get("award_floor"),
        ceiling=g.get("award_ceiling") or g.get("ceiling"),
        closeDate=g.get("close_date") or "",
        url=g.get("additional_info_url") or "",
        sourceUrl=g.get("source_url") or "",
        fetchedAt=g.get("fetched_at") or "",
        onDetails=_action("show_grant_detail", **ctx),
        onSave=_action("save_to_shortlist", **ctx),
        onDraft=_action("draft_proposal", **ctx),
    )


def _widget(tree: _Tree, w: dict, grant_sources: dict[str, list[dict]]) -> str | None:
    kind = (w.get("type") or "").lower()
    if kind == "metric":
        return tree.add("Metric", label=str(w.get("label") or ""), value=str(w.get("value") or ""),
                        caption=w.get("caption") or None)
    if kind == "bar_chart":
        data = w.get("data") or {}
        bars = [{"label": str(k), "value": float(v)} for k, v in data.items() if isinstance(v, (int, float))]
        if not bars:
            return None
        return tree.add("BarChart", title=w.get("title") or "", bars=bars[:10])
    if kind == "callout":
        tone = w.get("tone") if w.get("tone") in ("info", "success", "warning") else "info"
        return tree.add("Callout", tone=tone, title=w.get("title") or None, text=str(w.get("text") or ""))
    if kind == "checklist":
        items = [str(i) for i in (w.get("items") or []) if str(i).strip()]
        if not items:
            return None
        return tree.add("Checklist", title=w.get("title") or "", items=items[:15])
    if kind == "text":
        return tree.text(str(w.get("text") or ""))
    if kind == "grant_list":
        source = w.get("source") or "last_search"
        grants = (grant_sources.get(source) or [])[: int(w.get("limit") or 4)]
        if not grants:
            return tree.add("Callout", tone="info", text=f"No grants in '{source.replace('_', ' ')}' yet.")
        cards = [grant_card(tree, g) for g in grants]
        rows = [tree.add("Row", children=cards[i:i + 2]) for i in range(0, len(cards), 2)]
        header = tree.text(w.get("title") or source.replace("_", " ").title(), "h3")
        return tree.add("Column", children=[header, *rows])
    return None


def _group_metrics(tree: _Tree, ids_and_kinds: Iterable[tuple[str, str]]) -> list[str]:
    """Consecutive metrics sit side-by-side in a Row."""
    out: list[str] = []
    run: list[str] = []
    for cid, kind in ids_and_kinds:
        if kind == "metric":
            run.append(cid)
            continue
        if run:
            out.append(tree.add("Row", children=run) if len(run) > 1 else run[0])
            run = []
        out.append(cid)
    if run:
        out.append(tree.add("Row", children=run) if len(run) > 1 else run[0])
    return out


def surface_messages(surface_id: str, components: list[dict]) -> list[dict]:
    return [
        {"version": A2UI_VERSION, "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG_ID}},
        {"version": A2UI_VERSION, "updateComponents": {"surfaceId": surface_id, "components": components}},
    ]


def build_dashboard(surface_id: str, title: str, subtitle: str, widgets: list[dict],
                    grant_sources: dict[str, list[dict]]) -> list[dict]:
    tree = _Tree(prefix="w")
    head = [tree.text(title, "h1")]
    if subtitle:
        head.append(tree.text(subtitle, "caption"))
    built = []
    for w in widgets:
        cid = _widget(tree, w, grant_sources)
        if cid:
            built.append((cid, (w.get("type") or "").lower()))
    body = _group_metrics(tree, built)
    tree.add("Column", cid="root", children=[*head, *body])
    return surface_messages(surface_id, tree.components)


def build_comparison(surface_id: str, grants: list[dict]) -> list[dict]:
    """Side-by-side comparison: a CompareTable plus actionable cards."""

    def money(v):
        return f"${v:,.0f}" if isinstance(v, (int, float)) else "—"

    tree = _Tree(prefix="c")
    columns = [g.get("opportunity_title", "Untitled") for g in grants]
    rows = [
        {"label": "Agency", "values": [g.get("agency_name") or "—" for g in grants]},
        {"label": "Opportunity #", "values": [g.get("opportunity_number") or "—" for g in grants]},
        {"label": "Status", "values": [(g.get("opportunity_status") or "—").title() for g in grants]},
        {"label": "Award floor", "values": [money(g.get("award_floor")) for g in grants]},
        {"label": "Award ceiling", "values": [money(g.get("award_ceiling")) for g in grants]},
        {"label": "Total program funding", "values": [money(g.get("estimated_total_program_funding")) for g in grants]},
        {"label": "Expected awards", "values": [str(g.get("expected_number_of_awards") or "—") for g in grants]},
        {"label": "Deadline", "values": [g.get("close_date") or "Rolling / TBD" for g in grants]},
        {"label": "Cost sharing", "values": [
            "Required" if g.get("is_cost_sharing") else ("Not required" if g.get("is_cost_sharing") is False else "—")
            for g in grants]},
    ]
    title = tree.text("Side-by-side comparison", "h1")
    sub = tree.text(f"{len(grants)} opportunities", "caption")
    table = tree.add("CompareTable", columns=columns, rows=rows)
    cards = [grant_card(tree, g) for g in grants]
    card_row = tree.add("Row", children=cards)
    tree.add("Column", cid="root", children=[title, sub, table, card_row])
    return surface_messages(surface_id, tree.components)
