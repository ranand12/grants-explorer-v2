"""
UI side channel — lets tools push events straight to the connected browser.

Why this exists: with Gemini 3.8 Live, long tools run NON_BLOCKING in the
background. ADK persists their results to the session but does not yield their
state deltas on the run_live event stream, so the dashboard would never hear
about them. Tools publish here; the live WebSocket handler forwards to the client.

Keyed by ADK session id. If nobody is subscribed (e.g. the text/AG-UI path),
publish is a no-op and the UI picks the data up from session state instead.
"""

import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers[session_id].add(q)
    return q


def unsubscribe(session_id: str, q: asyncio.Queue) -> None:
    subs = _subscribers.get(session_id)
    if subs:
        subs.discard(q)
        if not subs:
            _subscribers.pop(session_id, None)


def publish(session_id: str | None, event: dict) -> None:
    if not session_id:
        return
    for q in list(_subscribers.get(session_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("ui_bus queue full for session %s; dropping %s", session_id, event.get("type"))
