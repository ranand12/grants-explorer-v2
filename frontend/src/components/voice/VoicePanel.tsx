"use client";

// Gemini 3.8 Live voice + vision panel.
//
// One WebSocket to the agent's /live endpoint carries mic audio, typed text,
// screen/camera frames and dashboard clicks up; audio, transcripts, tool
// activity and dashboard events come down. The session id is the shared
// CopilotKit thread id, so voice continues the text conversation.

import { useCallback, useEffect, useRef, useState } from "react";
import { Orb, type OrbMode } from "./Orb";
import { MicCapture, Speaker, FrameStreamer, b64ToArrayBuffer } from "./audio";
import { AGENT_HTTP, AGENT_WS } from "@/lib/identity";
import type { Source } from "@/lib/types";
import { CitationChip } from "@/components/sources";

type Status = "idle" | "connecting" | "live" | "reconnecting" | "error";

type SpeechItem = { id: string; kind: "user" | "agent"; text: string; final: boolean };
type Item =
  | SpeechItem
  | { id: string; kind: "tool"; label: string; status: string }
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "sources"; label: string; sources: Source[] }
  | { id: string; kind: "system"; text: string };

interface AgentConfig {
  voices: string[];
  default_voice: string;
  deep_mode_available: boolean;
  live_model: string;
  deep_model: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerMsg = Record<string, any>;

export interface VoicePanelProps {
  threadId: string;
  userId: string;
  onServerEvent: (msg: ServerMsg) => void;
  senderRef: React.MutableRefObject<((msg: object) => boolean) | null>;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const SUGGESTIONS = [
  "Find NSF grants for AI research",
  "What's closing in the next 30 days?",
  "I'm a nonprofit — what can I apply for?",
  "Compare the first two",
  "Give me a funding strategy briefing",
];

export function VoicePanel({ threadId, userId, onServerEvent, senderRef }: VoicePanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(0); // running tools
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [voice, setVoice] = useState("Kore");
  const [deep, setDeep] = useState(false);
  const [sharing, setSharing] = useState<"screen" | "camera" | null>(null);
  const [draft, setDraft] = useState("");
  const [modelName, setModelName] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const spkRef = useRef<Speaker | null>(null);
  const framesRef = useRef<FrameStreamer | null>(null);
  const seenSources = useRef(new Set<string>());
  const previewRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef(0);
  const micLevel = useRef(0);
  const wantLive = useRef(false);
  const retries = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onEventRef = useRef(onServerEvent);
  onEventRef.current = onServerEvent;

  useEffect(() => {
    fetch(`${AGENT_HTTP}/api/config`).then((r) => r.json()).then((c: AgentConfig) => {
      setCfg(c);
      setVoice(localStorage.getItem("grants.voice") || c.default_voice);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  // ── transcript helpers ──
  const upsertSpeech = useCallback((kind: "user" | "agent", text: string, finished: boolean) => {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === kind && !last.final) {
        const next = [...prev];
        // Gemini 3.8 sends incremental deltas, then the full text with finished=true
        next[next.length - 1] = { ...last, text: finished ? text : last.text + text, final: finished };
        return next;
      }
      // An agent turn can be split by a tool chip; keep one bubble per turn
      const idx = [...prev].reverse().findIndex((i) => i.kind === kind && !("final" in i && i.final));
      if (idx !== -1 && kind === "agent") {
        const at = prev.length - 1 - idx;
        const it = prev[at] as SpeechItem;
        const next = [...prev];
        next[at] = { ...it, text: finished ? text : it.text + text, final: finished };
        return next;
      }
      return [...prev, { id: uid(), kind, text, final: finished }];
    });
  }, []);

  const finalizeOpen = useCallback(() => {
    setItems((prev) => prev.map((i) => ("final" in i && !i.final ? { ...i, final: true } : i)));
  }, []);

  // ── server messages ──
  const handleMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case "audio":
        spkRef.current?.play(b64ToArrayBuffer(msg.data));
        return; // hot path — don't forward
      case "connected":
        setStatus("live");
        setModelName(msg.model);
        retries.current = 0;
        if (msg.resumed && !items.length) {
          setItems((p) => [...p, { id: uid(), kind: "system", text: "Continuing your conversation" }]);
        }
        break;
      case "input_transcript":
        upsertSpeech("user", msg.text, msg.finished);
        break;
      case "output_transcript":
        upsertSpeech("agent", msg.text, msg.finished);
        break;
      case "thought":
        setItems((p) => [...p, { id: uid(), kind: "thought", text: msg.text }]);
        break;
      case "tool_start":
        setBusy((b) => b + 1);
        setItems((p) => [...p, { id: msg.id || uid(), kind: "tool", label: msg.label, status: "running" }]);
        break;
      case "tool_end":
        setBusy((b) => Math.max(0, b - 1));
        setItems((p) => p.map((i) => (i.kind === "tool" && i.id === msg.id ? { ...i, status: msg.status } : i)));
        break;
      case "citations":
        if (msg.sources?.length) setItems((p) => [...p, { id: uid(), kind: "sources", label: "Web sources", sources: msg.sources }]);
        break;
      case "dashboard":
      case "state_update": {
        // Show where a new screen's data came from, once per source
        const fresh = ((msg.sources || []) as Source[]).filter((s) => s.kind !== "ai_generated" && !seenSources.current.has(s.id));
        fresh.forEach((s) => seenSources.current.add(s.id));
        if (fresh.length) setItems((p) => [...p, { id: uid(), kind: "sources", label: "Screen sources", sources: fresh }]);
        break;
      }
      case "interrupted":
        spkRef.current?.flush();
        finalizeOpen();
        break;
      case "turn_complete":
        finalizeOpen();
        break;
      case "status":
        if (msg.status === "reconnecting") setItems((p) => [...p, { id: uid(), kind: "system", text: "Refreshing connection…" }]);
        break;
      case "error":
        setItems((p) => [...p, { id: uid(), kind: "system", text: `⚠ ${msg.message}` }]);
        break;
    }
    onEventRef.current(msg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertSpeech, finalizeOpen]);

  // ── connection lifecycle ──
  const openSocket = useCallback(() => {
    const qs = new URLSearchParams({ session_id: threadId, user_id: userId, voice, mode: deep ? "deep" : "live" });
    const ws = new WebSocket(`${AGENT_WS}/live?${qs}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (wantLive.current && retries.current < 5) {
        // Transparent reconnect with the same session id — history is preserved server-side
        retries.current++;
        setStatus("reconnecting");
        setTimeout(() => wantLive.current && openSocket(), Math.min(500 * 2 ** retries.current, 8000));
      } else if (wantLive.current) {
        setStatus("error");
      }
    };
  }, [threadId, userId, voice, deep, handleMessage]);

  const send = useCallback((msg: object | ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    senderRef.current = status === "live" ? (m: object) => send(m) : null;
    return () => { senderRef.current = null; };
  }, [status, send, senderRef]);

  const start = useCallback(async () => {
    wantLive.current = true;
    retries.current = 0;
    setStatus("connecting");
    try {
      const spk = new Speaker((lvl, playing) => {
        levelRef.current = playing ? lvl : micLevel.current;
        setSpeaking((s) => (s !== playing ? playing : s));
      });
      await spk.start();
      spkRef.current = spk;
      const mic = new MicCapture((pcm) => send(pcm), (lvl) => {
        micLevel.current = lvl;
        if (!spkRef.current?.playing) levelRef.current = lvl;
      });
      await mic.start();
      micRef.current = mic;
      openSocket();
    } catch (e) {
      wantLive.current = false;
      setStatus("error");
      setItems((p) => [...p, { id: uid(), kind: "system", text: `⚠ ${e instanceof Error ? e.message : "Microphone unavailable"}` }]);
    }
  }, [openSocket, send]);

  const stopSharing = useCallback(() => {
    framesRef.current?.stop();
    framesRef.current = null;
    setSharing(null);
  }, []);

  const stop = useCallback(() => {
    wantLive.current = false;
    send({ type: "end" });
    wsRef.current?.close();
    wsRef.current = null;
    micRef.current?.stop();
    spkRef.current?.stop();
    micRef.current = spkRef.current = null;
    stopSharing();
    levelRef.current = 0;
    setStatus("idle");
    setSpeaking(false);
    setBusy(0);
  }, [send, stopSharing]);

  useEffect(() => () => { if (wantLive.current) stop(); }, [stop]);

  // Settings changes (voice / deep) need a fresh Live connection on the same session
  const restartIfLive = useRef(false);
  useEffect(() => {
    if (!restartIfLive.current) { restartIfLive.current = true; return; }
    if (wantLive.current && wsRef.current) {
      const old = wsRef.current;
      wsRef.current = null;
      old.close();
      setStatus("connecting");
      openSocket();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, deep]);

  // New conversation → reconnect on the new session
  const prevThread = useRef(threadId);
  useEffect(() => {
    if (prevThread.current !== threadId) {
      prevThread.current = threadId;
      setItems([]);
      if (wantLive.current) { stop(); }
    }
  }, [threadId, stop]);

  const toggleMute = () => { const m = !muted; setMuted(m); micRef.current?.setMuted(m); };

  const toggleShare = async (kind: "screen" | "camera") => {
    if (sharing === kind) return stopSharing();
    stopSharing();
    const fs = new FrameStreamer((b64) => send({ type: "image", data: b64, mime_type: "image/jpeg" }), () => setSharing(null));
    try {
      await fs.start(kind);
      framesRef.current = fs;
      setSharing(kind);
      setTimeout(() => { if (previewRef.current && fs.mediaStream) { previewRef.current.srcObject = fs.mediaStream; previewRef.current.play().catch(() => {}); } }, 0);
      setItems((p) => [...p, { id: uid(), kind: "system", text: kind === "screen" ? "Sharing your screen (1 frame/s)" : "Camera on (1 frame/s)" }]);
    } catch { /* user cancelled */ }
  };

  const submitText = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (send({ type: "text", text: t })) {
      spkRef.current?.flush();
      setItems((p) => [...p, { id: uid(), kind: "user", text: t, final: true }]);
      setDraft("");
    }
  };

  const live = status === "live" || status === "reconnecting";
  const orbMode: OrbMode =
    status === "connecting" || status === "reconnecting" ? "connecting"
      : !live ? "idle"
      : speaking ? "speaking"
      : busy > 0 ? "thinking"
      : "listening";
  const caption =
    status === "idle" ? "Tap to talk to your grants advisor"
      : status === "connecting" ? "Connecting to Gemini Live…"
      : status === "reconnecting" ? "Reconnecting…"
      : status === "error" ? "Connection problem — tap to retry"
      : muted ? "Muted"
      : orbMode === "speaking" ? "Speaking — just talk to interrupt"
      : orbMode === "thinking" ? "Working on it…"
      : "Listening";

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-white to-slate-50 border-l border-slate-200">
      {/* header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900">Live Advisor</p>
          <p className="text-[10px] text-slate-400 font-medium tracking-wide">
            {modelName || (deep ? cfg?.deep_model : cfg?.live_model) || "gemini-3.8-live"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={voice} onChange={(e) => { setVoice(e.target.value); localStorage.setItem("grants.voice", e.target.value); }}
            className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-600" title="Voice">
            {(cfg?.voices || ["Kore"]).map((v) => <option key={v}>{v}</option>)}
          </select>
          {cfg?.deep_mode_available && (
            <button onClick={() => setDeep(!deep)} title="Extended Thinking: slower, reasons through multi-step research"
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${deep ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"}`}>
              Deep think
            </button>
          )}
        </div>
      </div>

      {/* orb */}
      <div className="flex flex-col items-center pt-2 pb-3">
        <button onClick={live ? undefined : start} className={`rounded-full ${live ? "cursor-default" : "cursor-pointer hover:scale-[1.03]"} transition-transform`} aria-label="Start voice">
          <Orb mode={orbMode} levelRef={levelRef} />
        </button>
        <p className="text-xs text-slate-500 font-medium mt-1 h-4">{caption}</p>
        {live && (
          <div className="flex items-center gap-2 mt-3">
            <CtlButton active={muted} onClick={toggleMute} label={muted ? "Unmute" : "Mute"} icon={muted ? ICONS.micOff : ICONS.mic} />
            <CtlButton active={sharing === "screen"} onClick={() => toggleShare("screen")} label="Share screen" icon={ICONS.screen} />
            <CtlButton active={sharing === "camera"} onClick={() => toggleShare("camera")} label="Camera" icon={ICONS.camera} />
            <button onClick={stop} className="text-xs font-semibold px-4 py-2 rounded-full bg-rose-500 text-white hover:bg-rose-600 shadow-sm">End</button>
          </div>
        )}
        {sharing && (
          <video ref={previewRef} muted playsInline className="mt-3 w-40 rounded-lg border border-slate-200 shadow-sm" />
        )}
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5">
        {items.length === 0 && (
          <div className="pt-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">Try saying</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => (live ? submitText(s) : start().then(() => setDraft(s)))}
                  className="text-xs text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-emerald-300 hover:text-emerald-700">
                  &ldquo;{s}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it) => <TranscriptItem key={it.id} item={it} />)}
      </div>

      {/* text input */}
      <form onSubmit={(e) => { e.preventDefault(); submitText(draft); }} className="p-3 border-t border-slate-200 bg-white flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!live}
          placeholder={live ? "Type while you talk…" : "Start voice to chat"}
          className="flex-1 text-sm px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-50" />
        <button disabled={!live || !draft.trim()} className="text-sm font-semibold px-4 rounded-xl bg-slate-900 text-white disabled:opacity-30">Send</button>
      </form>
    </div>
  );
}

const svg = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONS = {
  mic: svg(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></>),
  micOff: svg(<><path d="M2 2l20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 11.2 5.6M12 17v5" /></>),
  screen: svg(<><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>),
  camera: svg(<><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>),
};

function CtlButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm border transition-colors ${active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"}`}>
      {icon}
    </button>
  );
}

function TranscriptItem({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <p className={`max-w-[85%] text-sm px-3.5 py-2 rounded-2xl rounded-br-md bg-slate-900 text-white ${item.final ? "" : "opacity-70"}`}>{item.text}</p>
        </div>
      );
    case "agent":
      return (
        <div className="flex">
          <p className={`max-w-[90%] text-sm px-3.5 py-2 rounded-2xl rounded-bl-md bg-white border border-slate-200 text-slate-800 ${item.final ? "" : "opacity-80"}`}>{item.text}</p>
        </div>
      );
    case "tool":
      return (
        <div className="flex">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            item.status === "running" ? "bg-violet-50 text-violet-700 border-violet-200"
              : item.status === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : item.status === "no_results" ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-rose-50 text-rose-700 border-rose-200"}`}>
            {item.status === "running" ? <span className="w-2 h-2 rounded-full bg-violet-500 animate-ping" /> : item.status === "ok" ? "✓" : item.status === "no_results" ? "∅" : "!"}
            {item.label}{item.status === "running" ? "…" : ""}
          </span>
        </div>
      );
    case "thought":
      return <p className="text-[11px] italic text-violet-500/80 pl-2 border-l-2 border-violet-200 line-clamp-3">{item.text}</p>;
    case "sources":
      return (
        <div className="voice-sources flex flex-wrap items-center gap-1.5 pl-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{item.label}</span>
          {item.sources.slice(0, 6).map((s, i) => (
            <span key={s.id} className="inline-flex items-center gap-1">
              <CitationChip n={i + 1} source={s} />
              <span className="text-[10px] text-slate-500 truncate max-w-[130px]">{s.kind === "web" ? s.detail || s.title : s.title}</span>
            </span>
          ))}
          {item.sources.length > 6 && <span className="text-[10px] text-slate-400">+{item.sources.length - 6}</span>}
        </div>
      );
    case "system":
      return <p className="text-center text-[11px] text-slate-400">{item.text}</p>;
  }
}
