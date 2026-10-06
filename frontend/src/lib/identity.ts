// Stable browser identity + conversation ids.
//
// Thread ids are "<userId>~<conversationId>". The same id is the CopilotKit
// thread id AND the ADK session id for /live, so text and voice share one
// conversation. The backend also recovers the user id from the prefix.

const USER_KEY = "grants.userId";
const CONV_KEY = "grants.conversationId";

const rand = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))
    .replace(/-/g, "")
    .slice(0, 12);

export function getUserId(): string {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = `u${rand()}`;
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

export function getThreadId(): string {
  let conv = localStorage.getItem(CONV_KEY);
  if (!conv) {
    conv = `c${rand()}`;
    localStorage.setItem(CONV_KEY, conv);
  }
  return `${getUserId()}~${conv}`;
}

export function newThreadId(): string {
  localStorage.setItem(CONV_KEY, `c${rand()}`);
  return getThreadId();
}

// Default: the agent is proxied same-origin under /agent by server.mjs, so the
// app works behind Cloud Workstations / Cloud Run without CORS or extra ports.
// Set NEXT_PUBLIC_AGENT_URL only to talk to the agent directly.
const DIRECT = process.env.NEXT_PUBLIC_AGENT_URL;
export const AGENT_HTTP = DIRECT || "/agent";
export const AGENT_WS = DIRECT
  ? DIRECT.replace(/^http/, "ws")
  : typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/agent`
    : "";
