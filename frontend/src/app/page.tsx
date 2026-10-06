"use client";

// Grants Explorer v2 — one conversation across text (CopilotKit / AG-UI) and
// voice (Gemini 3.8 Live over /live). Dashboards come from three sources that
// all feed one store: agent state (text), ui_bus over SSE (text, real-time
// tool chips + streaming drafts) and ui_bus over the voice WebSocket.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CopilotKit, useCoAgent, useCopilotChat } from "@copilotkit/react-core";
import { CopilotSidebar, AssistantMessage, type AssistantMessageProps } from "@copilotkit/react-ui";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";

import {
  EMPTY_DASHBOARD, type DashboardState, type ShortlistEntry, type UserProfile, type ToolActivity, type Source,
} from "@/lib/types";
import { AGENT_HTTP, getThreadId, getUserId, newThreadId } from "@/lib/identity";
import { ActionContext, actionToText, type UiActionContext } from "@/lib/actions";
import {
  GrantCard, GrantDetailView, GrantStatsView, DeadlineTrackerView, AgencyOverviewView,
  EligibilityMatchView, GrantDraftDocument,
} from "@/components/dashboards";
import { A2uiView } from "@/components/a2ui/A2uiView";
import { VoicePanel } from "@/components/voice/VoicePanel";
import { ShortlistTray } from "@/components/ShortlistTray";
import { CitationRow, ProvenanceFooter, SourcesPanel } from "@/components/sources";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMsg = Record<string, any>;

const DASH_KEYS = Object.keys(EMPTY_DASHBOARD) as (keyof DashboardState)[];

function pickDashboard(src: AnyMsg): Partial<DashboardState> {
  const out: AnyMsg = {};
  for (const k of DASH_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out as Partial<DashboardState>;
}

// ── Screen history ──
// Every distinct view (type + query + subject) is a "screen". Screens form a
// browser-style stack: Back/Forward buttons, the breadcrumb trail, browser
// back/forward and Alt+←/→ all move through it via window.history, so the
// in-app index and the browser's entries never disagree.

function screenKey(d: DashboardState): string {
  const subject =
    d.dashboard_type === "grant_draft" ? d.grant_draft?.opportunity_title
    : d.dashboard_type === "grant_detail" ? d.grant_detail?.opportunity_title
    : d.dashboard_type === "a2ui" ? d.a2ui_messages?.[0]?.createSurface?.surfaceId
    : d.last_query;
  return `${d.dashboard_type}|${subject ?? ""}`;
}

const SCREEN_NAMES: Record<string, string> = {
  grants: "Search", grant_detail: "Details", grant_draft: "Draft", grant_stats: "Stats",
  deadline_tracker: "Deadlines", agency_overview: "Agency", eligibility_match: "Eligibility", a2ui: "View",
};

function screenLabel(d: DashboardState): string {
  const subject =
    d.dashboard_type === "grant_detail" ? d.grant_detail?.opportunity_title
    : d.dashboard_type === "grant_draft" ? d.grant_draft?.project_title || d.grant_draft?.opportunity_title
    : d.dashboard_type === "agency_overview" ? d.agency_data?.agency_name
    : d.last_query;
  if (!d.dashboard_type) return "Home";
  const name = SCREEN_NAMES[d.dashboard_type] || "View";
  return subject ? `${name}: ${subject}` : name;
}

type Nav = { stack: DashboardState[]; index: number; pushes: number };
const INITIAL_NAV: Nav = { stack: [EMPTY_DASHBOARD], index: 0, pushes: 0 };

// ── Dashboard store ──

function mergeSources(a: Source[] = [], b: Source[] = []): Source[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((s) => !seen.has(s.id) && !!seen.add(s.id));
}

// Web citations for the chat, grouped by conversation turn (= user messages so far)
type TurnCitations = Record<number, Source[]>;
type CitationCtx = { turns: TurnCitations; openSources: () => void; syncTurns: (n: number) => void };
const CitationContext = createContext<CitationCtx>({ turns: {}, openSources: () => {}, syncTurns: () => {} });

function useDashboardStore() {
  const [nav, setNav] = useState<Nav>(INITIAL_NAV);
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [profile, setProfile] = useState<UserProfile>({});
  const [activity, setActivity] = useState<ToolActivity[]>([]);
  const dash = nav.stack[nav.index];

  const applyDashboard = useCallback((update: Partial<DashboardState>) => {
    setNav((n) => {
      const top = n.stack.length - 1;
      const merge = (prev: DashboardState) => {
        // New view type → drop stale data from the previous view
        const base = update.dashboard_type && update.dashboard_type !== prev.dashboard_type ? EMPTY_DASHBOARD : prev;
        return { ...base, ...update };
      };
      // User went back while the latest screen is still filling in → update it quietly
      if (n.index < top) {
        const latest = merge(n.stack[top]);
        if (screenKey(latest) === screenKey(n.stack[top])) {
          return { ...n, stack: [...n.stack.slice(0, top), latest] };
        }
      }
      const cur = n.stack[n.index];
      const next = merge(cur);
      if (screenKey(next) === screenKey(cur)) {
        const stack = [...n.stack];
        stack[n.index] = next;
        return { ...n, stack };
      }
      // A new screen: drop any forward entries, like a browser
      const stack = [...n.stack.slice(0, n.index + 1), next].slice(-30);
      return { stack, index: stack.length - 1, pushes: n.pushes + 1 };
    });
  }, []);

  const handleEvent = useCallback((msg: AnyMsg) => {
    switch (msg.type) {
      case "dashboard":
      case "state_update":
        applyDashboard(pickDashboard(msg));
        if (msg["user:shortlist"]) setShortlist(msg["user:shortlist"]);
        break;
      case "connected": {
        const st = msg.state || {};
        if (st.dashboard_type) applyDashboard(pickDashboard(st));
        if (st["user:shortlist"]) setShortlist(st["user:shortlist"]);
        if (st["user:profile"]) setProfile(st["user:profile"]);
        break;
      }
      case "draft_section":
        // Patch the draft wherever it sits in history, so it keeps streaming after Back
        setNav((n) => ({
          ...n,
          stack: n.stack.map((s) => {
            const d = s.grant_draft;
            if (s.dashboard_type !== "grant_draft" || !d || (d.draft_id && d.draft_id !== msg.draft_id)) return s;
            const sections = [...d.sections];
            sections[msg.index] = msg.section;
            return { ...s, grant_draft: { ...d, sections } };
          }),
        }));
        break;
      case "citations":
        // Google Search grounding: attach to the latest screen (keeps its key, so no new history entry)
        setNav((n) => {
          const top = n.stack.length - 1;
          const s = n.stack[top];
          const stack = [...n.stack];
          stack[top] = { ...s, sources: mergeSources(s.sources, msg.sources), search_html: msg.search_html || s.search_html };
          return { ...n, stack };
        });
        break;
      case "shortlist":
        setShortlist(msg.shortlist || []);
        break;
      case "profile":
        setProfile(msg.profile || {});
        break;
      case "tool_start":
        setActivity((a) => [...a.slice(-5), { id: msg.id, name: msg.name, label: msg.label, status: "running", startedAt: Date.now() }]);
        break;
      case "tool_end":
        setActivity((a) => a.map((t) => (t.id === msg.id ? { ...t, status: msg.status } : t)));
        setTimeout(() => setActivity((a) => a.filter((t) => t.id !== msg.id)), 2500);
        break;
    }
  }, [applyDashboard]);

  // Mirror new screens into browser history; follow browser back/forward
  const gen = useRef(Date.now());
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, gxGen: gen.current, gxScreen: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const st = e.state;
      if (st?.gxGen !== gen.current || typeof st.gxScreen !== "number") return;
      setNav((n) => ({ ...n, index: Math.min(Math.max(st.gxScreen, 0), n.stack.length - 1) }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (nav.pushes) window.history.pushState({ gxGen: gen.current, gxScreen: nav.index }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.pushes]);

  const go = useCallback((delta: number) => { if (delta) window.history.go(delta); }, []);

  const reset = useCallback(() => {
    gen.current = Date.now();
    window.history.replaceState({ ...window.history.state, gxGen: gen.current, gxScreen: 0 }, "");
    setNav(INITIAL_NAV);
    setActivity([]);
  }, []);

  return {
    dash, nav, go, shortlist, profile, activity, applyDashboard, handleEvent, reset, setShortlist, setProfile,
  };
}

function ScreenNav({ nav, go, onSources }: { nav: Nav; go: (delta: number) => void; onSources: () => void }) {
  const nSources = nav.stack[nav.index].sources?.length || 0;
  if (nav.stack.length < 2 && !nSources) return null;
  const canBack = nav.index > 0;
  const canFwd = nav.index < nav.stack.length - 1;
  // Trail: up to 5 screens around the current one
  const from = Math.max(0, Math.min(nav.index - 2, nav.stack.length - 5));
  const trail = nav.stack.slice(from, from + 5).map((s, i) => ({ s, i: from + i }));
  const btn = "inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-35 disabled:cursor-not-allowed";
  return (
    <nav aria-label="Screen history" className="flex items-center gap-2 mb-6 -mt-4">
      {nav.stack.length > 1 && <>
      <button onClick={() => go(-1)} disabled={!canBack} aria-label="Back" title="Back (Alt+←)"
        className={`${btn} bg-white border-slate-200 text-slate-700 hover:border-slate-400`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Back
      </button>
      <button onClick={() => go(1)} disabled={!canFwd} aria-label="Forward" title="Forward (Alt+→)"
        className={`${btn} bg-white border-slate-200 text-slate-700 hover:border-slate-400`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
      </button>
      </>}
      <ol className="flex items-center gap-1 ml-2 min-w-0 overflow-hidden text-xs">
        {nav.stack.length > 1 && from > 0 && <li className="text-slate-300 px-1">…</li>}
        {nav.stack.length > 1 && trail.map(({ s, i }, k) => (
          <li key={i} className="flex items-center gap-1 min-w-0">
            {k > 0 && <span className="text-slate-300">›</span>}
            <button onClick={() => go(i - nav.index)} disabled={i === nav.index} title={screenLabel(s)}
              className={`truncate max-w-[14rem] px-2 py-1 rounded-md ${i === nav.index ? "bg-slate-900 text-white font-semibold" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}>
              {screenLabel(s)}
            </button>
          </li>
        ))}
      </ol>
      {nSources > 0 && (
        <button onClick={onSources} aria-label="Sources for this screen"
          className={`${btn} ml-auto shrink-0 bg-white border-emerald-200 text-emerald-800 hover:border-emerald-400`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" /><path d="M8 7h8M8 11h6" /></svg>
          Sources ({nSources})
        </button>
      )}
    </nav>
  );
}

// ── Dashboard router ──

function Dashboard({ dash }: { dash: DashboardState }) {
  const q = dash.last_query;
  switch (dash.dashboard_type) {
    case "a2ui":
      return dash.a2ui_messages ? <A2uiView messages={dash.a2ui_messages} /> : null;
    case "grant_draft":
      return dash.grant_draft ? <GrantDraftDocument draft={dash.grant_draft} /> : null;
    case "grant_detail":
      return dash.grant_detail ? <GrantDetailView grant={dash.grant_detail} /> : null;
    case "grant_stats":
      return dash.grant_stats ? <GrantStatsView stats={dash.grant_stats} query={q} /> : null;
    case "deadline_tracker":
      return <DeadlineTrackerView grants={dash.deadline_grants || []} days={dash.deadline_days || 90} query={q} />;
    case "agency_overview":
      return dash.agency_data ? <AgencyOverviewView data={dash.agency_data} /> : null;
    case "eligibility_match":
      return dash.eligibility_data ? <EligibilityMatchView data={dash.eligibility_data} /> : null;
    case "grants":
      return (
        <>
          <div className="flex items-end gap-4 mb-8">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Grant Opportunities</p>
              <h2 className="text-3xl font-bold text-slate-900">{q}</h2>
            </div>
            <span className="text-xs px-3 py-1.5 rounded-full font-semibold mb-1 bg-emerald-50 text-emerald-700 border border-emerald-200">
              {dash.grants_data.length} result{dash.grants_data.length !== 1 ? "s" : ""}
            </span>
          </div>
          {dash.grants_data.length === 0 ? (
            <p className="text-slate-400">No open opportunities matched. Try broader terms.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 stagger-children">
              {dash.grants_data.map((g, i) => <GrantCard key={`${g.opportunity_number}-${i}`} grant={g} />)}
            </div>
          )}
        </>
      );
    default:
      return <Welcome />;
  }
}

function Welcome() {
  return (
    <div className="text-center py-20 animate-fade-in-up">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 mb-8 animate-float">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h2 className="text-3xl font-bold text-slate-800 mb-3">Talk to your grants advisor</h2>
      <p className="text-slate-400 max-w-lg mx-auto mb-10 leading-relaxed">
        Search live Grants.gov data, compare opportunities, build a shortlist, and get a full AI-written proposal draft —
        by voice, text, or by sharing your screen. Switch between voice and text any time; it&apos;s one conversation.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto stagger-children text-left">
        {[
          { t: "Real-time voice", d: "Gemini 3.8 Live. Interrupt any time — it keeps talking while tools run." },
          { t: "Agent-built views", d: "Comparisons, briefings and checklists rendered as A2UI." },
          { t: "Remembers you", d: "Your organization, interests and shortlist carry across sessions." },
          { t: "Screen & camera", d: "Share a NOFO PDF or budget sheet and ask about it." },
          { t: "Deep think", d: "Extended Thinking mode for multi-step funding research." },
          { t: "Live web context", d: "Google Search grounding for budget news and policy changes." },
        ].map((f) => (
          <div key={f.t} className="bg-white border border-slate-200/80 rounded-xl px-4 py-3.5">
            <p className="text-sm font-semibold text-slate-800">{f.t}</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityBar({ activity }: { activity: ToolActivity[] }) {
  if (!activity.length) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex gap-2" style={{ marginLeft: "-14rem" }}>
      {activity.map((a) => (
        <span key={a.id} className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border animate-fade-in-up ${
          a.status === "running" ? "bg-white text-violet-700 border-violet-200" : a.status === "ok" ? "bg-white text-emerald-700 border-emerald-200" : "bg-white text-amber-700 border-amber-200"}`}>
          {a.status === "running" ? <span className="w-2 h-2 rounded-full bg-violet-500 animate-ping" /> : "✓"} {a.label}
        </span>
      ))}
    </div>
  );
}

// ── App ──

function AppContent({ threadId, userId, onNewConversation }: { threadId: string; userId: string; onNewConversation: () => void }) {
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [trayOpen, setTrayOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const store = useDashboardStore();
  const { handleEvent: storeEvent, applyDashboard, setShortlist, setProfile } = store;
  const voiceSender = useRef<((msg: object) => boolean) | null>(null);
  const { appendMessage } = useCopilotChat();

  // Chat citations: remember which turn each grounding result belongs to
  const [turns, setTurns] = useState<TurnCitations>({});
  // = user messages so far; bumped on submit, re-synced from the message list by CitedAssistantMessage
  const userTurns = useRef(0);
  const handleEvent = useCallback((msg: AnyMsg) => {
    if (msg.type === "citations" && msg.sources?.length) {
      const t = userTurns.current;
      setTurns((c) => ({ ...c, [t]: mergeSources(c[t], msg.sources) }));
    }
    storeEvent(msg);
  }, [storeEvent]);
  const citationCtx = useMemo(() => ({
    turns, openSources: () => setSourcesOpen(true), syncTurns: (n: number) => { userTurns.current = n; },
  }), [turns]);

  // Rehydrate dashboard + memory for this conversation (after reloads)
  useEffect(() => {
    fetch(`${AGENT_HTTP}/api/state/${encodeURIComponent(userId)}/${encodeURIComponent(threadId)}`)
      .then((r) => r.json())
      .then(({ state }) => handleEvent({ type: "connected", state }))
      .catch(() => {});
  }, [threadId, userId, handleEvent]);

  // Text mode: real-time tool chips, streaming drafts, shortlist via SSE
  useEffect(() => {
    if (mode !== "text") return;
    const es = new EventSource(`${AGENT_HTTP}/api/events/${encodeURIComponent(threadId)}`);
    es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
    return () => es.close();
  }, [mode, threadId, handleEvent]);

  // Text mode fallback: final agent state from AG-UI
  const { state: agentState } = useCoAgent<AnyMsg>({ name: "grants_advisor", initialState: {} });
  const lastSig = useRef("");
  useEffect(() => {
    if (mode !== "text" || !agentState?.dashboard_type) return;
    const sig = JSON.stringify([agentState.dashboard_type, agentState.last_query, agentState.grant_draft?.generating,
      agentState.a2ui_messages?.[0]?.createSurface?.surfaceId]);
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    applyDashboard(pickDashboard(agentState));
    if (agentState["user:shortlist"]) setShortlist(agentState["user:shortlist"]);
    if (agentState["user:profile"]) setProfile(agentState["user:profile"]);
  }, [mode, agentState, applyDashboard, setShortlist, setProfile]);

  const dispatch = useCallback((name: string, context: UiActionContext) => {
    if (mode === "voice" && voiceSender.current?.({ type: "ui_action", name, context })) return;
    // Text mode (or voice not connected): send as a chat message
    if (mode !== "text") setMode("text");
    userTurns.current += 1;
    appendMessage(new TextMessage({ role: MessageRole.User, content: actionToText(name, context) }));
  }, [mode, appendMessage]);

  const profileLabel = store.profile.organization_name || store.profile.organization_type;

  return (
    <ActionContext.Provider value={dispatch}>
    <CitationContext.Provider value={citationCtx}>
      <div className="noise-bg">
        <main className="min-h-screen p-8 lg:p-12" style={{ marginRight: "28rem" }}>
          <div className="max-w-5xl mx-auto">
            <header className="mb-10">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400 font-semibold mb-2">AI-Powered Grants Advisor · Gemini 3.8 Live</p>
                  <h1 className="text-5xl font-extrabold text-slate-900 mb-3">Grants Explorer</h1>
                  <p className="text-slate-400 text-lg font-light">
                    Find, compare & apply to federal grants
                    {profileLabel && <span className="ml-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full align-middle">Personalized for {profileLabel}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-1 flex gap-1 shadow-sm">
                    {(["voice", "text"] as const).map((m) => (
                      <button key={m} onClick={() => setMode(m)}
                        className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${mode === m ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                        {m === "voice" ? "Live Voice" : "Text Chat"}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setTrayOpen(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-amber-300">
                      &#9733; Shortlist{store.shortlist.length ? ` (${store.shortlist.length})` : ""}
                    </button>
                    <button onClick={() => { store.reset(); onNewConversation(); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-slate-400">
                      New conversation
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-8 h-px bg-gradient-to-r from-slate-200 via-slate-200 to-transparent" />
            </header>
            <ScreenNav nav={store.nav} go={store.go} onSources={() => setSourcesOpen(true)} />
            <div key={`${store.nav.index}-${screenKey(store.dash)}`} className="animate-fade-in">
              <Dashboard dash={store.dash} />
              <ProvenanceFooter sources={store.dash.sources || []} onOpen={() => setSourcesOpen(true)} />
            </div>
          </div>
        </main>

        <ActivityBar activity={mode === "text" ? store.activity : []} />
        <ShortlistTray open={trayOpen} onClose={() => setTrayOpen(false)} items={store.shortlist} />
        <SourcesPanel open={sourcesOpen} onClose={() => setSourcesOpen(false)} sources={store.dash.sources || []}
          searchHtml={store.dash.search_html} screen={screenLabel(store.dash)} />

        {mode === "text" ? (
          <CopilotSidebar defaultOpen clickOutsideToClose={false} AssistantMessage={CitedAssistantMessage}
            onSubmitMessage={() => { userTurns.current += 1; }}
            labels={{
              title: "Grants Explorer",
              initial: "Hi! I share memory with the voice advisor — pick up wherever you left off.\n\nTry:\n- \"Find NSF grants for AI research\"\n- \"Compare the first two\"\n- \"Give me a readiness checklist for an NIH R01\"\n- \"Any recent news on the NSF budget?\"",
            }} />
        ) : (
          <div className="fixed top-0 right-0 w-[28rem] h-screen z-50 shadow-2xl">
            <VoicePanel threadId={threadId} userId={userId} onServerEvent={handleEvent} senderRef={voiceSender} />
          </div>
        )}
      </div>
    </CitationContext.Provider>
    </ActionContext.Provider>
  );
}

// Default assistant bubble + a chip row with the web sources for that turn,
// shown on the last assistant message before the next user message.
function CitedAssistantMessage(props: AssistantMessageProps) {
  const { turns, openSources, syncTurns } = useContext(CitationContext);
  const msgs = props.messages || [];
  const total = msgs.filter((m) => m.role === "user").length;
  useEffect(() => { syncTurns(total); }, [total, syncTurns]);
  const i = msgs.findIndex((m) => m.id === props.message?.id);
  let cites: Source[] = [];
  if (i >= 0) {
    const turn = msgs.slice(0, i).filter((m) => m.role === "user").length;
    const next = msgs.slice(i + 1).find((m) => m.role === "user" || (m.role === "assistant" && m.content));
    if (!next || next.role === "user") cites = turns[turn] || [];
  }
  return (
    <>
      <AssistantMessage {...props} />
      {cites.length > 0 && !props.isGenerating && (
        <div className="px-4 -mt-1 mb-2"><CitationRow sources={cites} onOpen={openSources} label="Web sources" /></div>
      )}
    </>
  );
}

export default function Home() {
  const [ids, setIds] = useState<{ userId: string; threadId: string } | null>(null);
  useEffect(() => { setIds({ userId: getUserId(), threadId: getThreadId() }); }, []);
  const properties = useMemo(() => (ids ? { user_id: ids.userId } : {}), [ids]);
  if (!ids) return null;
  return (
    // key: a new conversation remounts CopilotKit so chat history resets too
    <CopilotKit key={ids.threadId} runtimeUrl="/api/copilotkit" agent="grants_advisor" threadId={ids.threadId} properties={properties} enableInspector={false}>
      <AppContent threadId={ids.threadId} userId={ids.userId}
        onNewConversation={() => setIds({ userId: ids.userId, threadId: newThreadId() })} />
    </CopilotKit>
  );
}
