"""
Runtime configuration — everything environment-specific lives here so the same
image runs locally, on Cloud Run, or against Vertex AI without code changes.
"""

import os

from dotenv import load_dotenv

load_dotenv()

APP_NAME = "grants_explorer"

# ── Models ──
# Text chat (AG-UI / CopilotKit sidebar)
TEXT_MODEL = os.getenv("TEXT_MODEL", "gemini-3.5-flash")
# Real-time voice (Live API). gemini-3.8-live is GA on the Gemini API and Vertex.
LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
# "Deep think" voice mode. Gemini API only (not on Vertex yet) — async tools only,
# and a thinking level MUST be sent or the connection is rejected (1007).
DEEP_LIVE_MODEL = os.getenv("DEEP_LIVE_MODEL", "gemini-3.8-live-extended-thinking")
DEEP_THINKING_LEVEL = os.getenv("DEEP_THINKING_LEVEL", "medium")  # low | medium | high
# Background model that writes proposal sections while the voice agent keeps talking
DRAFT_MODEL = os.getenv("DRAFT_MODEL", "gemini-3.5-flash")

USE_VERTEX = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "FALSE").upper() in ("1", "TRUE", "YES")
DEEP_MODE_AVAILABLE = not USE_VERTEX and os.getenv("DISABLE_DEEP_MODE", "") == ""

DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "Kore")
VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"]

# ── Sessions ──
# SQLite locally; point at Cloud SQL Postgres (postgresql+asyncpg://...) in prod so
# sessions survive restarts and Cloud Run scale-out.
SESSION_DB_URL = os.getenv("SESSION_DB_URL", "sqlite+aiosqlite:///./grants_sessions.db")

# ── Security ──
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
# Optional shared secret for /live. Empty = no auth (local dev only).
LIVE_AUTH_TOKEN = os.getenv("LIVE_AUTH_TOKEN", "")

PORT = int(os.getenv("PORT", "8001"))

# Domain vocabulary for the Live API transcriber — improves recognition of
# agency acronyms and program names in the user's speech.
TRANSCRIPTION_VOCABULARY = [
    "NSF", "NIH", "DOE", "DARPA", "NOAA", "NASA", "USDA", "EPA", "HHS", "DOD",
    "SBIR", "STTR", "NOFO", "R01", "R21", "K99", "CAREER", "ARPA-E", "ARPA-H",
    "Grants.gov", "SAM.gov", "UEI", "501(c)(3)", "cooperative agreement",
    "indirect costs", "cost sharing", "principal investigator",
]
