"use client";

// Citations UI. Every screen carries `sources` (agent/sources.py); this file
// renders them at three depths: a one-line footer on cards, numbered chips
// with a hover card (chat, voice captions, drafts), and a per-screen panel.

import { useState } from "react";
import type { Source, SourceKind } from "@/lib/types";
import { timeAgo } from "@/lib/format";

export const KIND: Record<SourceKind, { label: string; dot: string; chip: string; text: string }> = {
  grants_gov: { label: "Official · Grants.gov", dot: "bg-emerald-500", chip: "bg-emerald-50 border-emerald-200 text-emerald-800", text: "text-emerald-700" },
  web: { label: "Web", dot: "bg-sky-500", chip: "bg-sky-50 border-sky-200 text-sky-800", text: "text-sky-700" },
  your_input: { label: "Your input", dot: "bg-violet-500", chip: "bg-violet-50 border-violet-200 text-violet-800", text: "text-violet-700" },
  template: { label: "Template", dot: "bg-slate-400", chip: "bg-slate-50 border-slate-200 text-slate-700", text: "text-slate-600" },
  ai_generated: { label: "AI-written", dot: "bg-amber-500", chip: "bg-amber-50 border-amber-200 text-amber-800", text: "text-amber-700" },
};

const meta = (k?: string) => KIND[(k as SourceKind) || "web"] || KIND.web;

export function SourceBadge({ kind }: { kind: SourceKind }) {
  const m = meta(kind);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

/** Card footer: "● Grants.gov · HHS-2026-01 · fetched 2m ago ↗" */
export function SourceLine({ url, detail, fetchedAt, kind = "grants_gov" }: { url?: string; detail?: string; fetchedAt?: string; kind?: SourceKind }) {
  if (!url && !fetchedAt) return null;
  const m = meta(kind);
  const body = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} shrink-0`} />
      <span className="font-semibold">{kind === "grants_gov" ? "Grants.gov" : m.label}</span>
      {detail && <span className="truncate">· {detail}</span>}
      {fetchedAt && <span className="shrink-0">· fetched {timeAgo(fetchedAt)}</span>}
      {url && <span aria-hidden className="shrink-0">↗</span>}
    </>
  );
  const cls = "source-line flex items-center gap-1.5 text-[11px] text-slate-400 min-w-0";
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`${cls} hover:text-slate-700`} title="Open the original listing">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Numbered chip with a hover card showing the source. */
export function CitationChip({ n, source }: { n: number | string; source?: Source }) {
  const m = meta(source?.kind);
  const chip = (
    <span className={`citation-chip inline-flex items-center justify-center min-w-[1.25rem] h-[1.1rem] px-1 rounded border text-[10px] font-bold align-super leading-none ${m.chip}`}>
      {n}
    </span>
  );
  return (
    <span className="relative inline-block group/cite not-prose">
      {source?.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${source.title}`}>{chip}</a>
      ) : chip}
      {source && (
        <span role="tooltip" className="pointer-events-none absolute z-[80] left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-64 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl opacity-0 group-hover/cite:opacity-100 transition-opacity">
          <SourceBadge kind={source.kind} />
          <span className="block text-xs font-semibold text-slate-900 mt-1 leading-snug">{source.title}</span>
          {source.detail && <span className="block text-[11px] text-slate-500 mt-0.5">{source.detail}</span>}
          {source.fetched_at && <span className="block text-[10px] text-slate-400 mt-1">Fetched {timeAgo(source.fetched_at)}</span>}
        </span>
      )}
    </span>
  );
}

/** Row of chips, e.g. under an assistant message. */
export function CitationRow({ sources, onOpen, label = "Sources" }: { sources: Source[]; onOpen?: () => void; label?: string }) {
  if (!sources.length) return null;
  return (
    <div className="citation-row flex flex-wrap items-center gap-1.5 mt-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-0.5">{label}</span>
      {sources.slice(0, 8).map((s, i) => (
        <span key={s.id} className="inline-flex items-center gap-1">
          <CitationChip n={i + 1} source={s} />
          <span className="text-[11px] text-slate-500 max-w-[9rem] truncate">{s.kind === "web" ? s.detail || s.title : s.title}</span>
        </span>
      ))}
      {onOpen && sources.length > 0 && (
        <button onClick={onOpen} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline">
          {sources.length > 8 ? `+${sources.length - 8} more` : "details"}
        </button>
      )}
    </div>
  );
}

/** Google Search Suggestions chip bar: required whenever Search grounding is shown. */
export function SearchSuggestions({ html }: { html: string }) {
  const [h, setH] = useState(64);
  if (!html) return null;
  return (
    <iframe
      title="Google Search suggestions"
      srcDoc={html}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      className="w-full border-0"
      style={{ height: h }}
      onLoad={(e) => {
        const d = e.currentTarget.contentDocument;
        if (d?.body) setH(Math.min(160, d.body.scrollHeight + 8));
      }}
    />
  );
}

/** One line under every dashboard: where this screen came from. */
export function ProvenanceFooter({ sources, onOpen }: { sources: Source[]; onOpen: () => void }) {
  if (!sources.length) return null;
  const first = sources[0];
  const kinds = [...new Set(sources.map((s) => s.kind))];
  return (
    <div className="provenance-footer mt-8 pt-4 border-t border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span className="font-semibold text-slate-600">Where this came from:</span>
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full ${meta(first.kind).dot}`} />
        <span className="truncate max-w-[28rem]">{first.title}{first.detail ? ` — ${first.detail}` : ""}</span>
        {first.fetched_at && <span className="text-slate-400">· {timeAgo(first.fetched_at)}</span>}
      </span>
      <span className="flex items-center gap-2">
        {kinds.map((k) => <SourceBadge key={k} kind={k} />)}
      </span>
      <button onClick={onOpen} className="ml-auto font-semibold text-slate-700 hover:text-slate-900 hover:underline underline-offset-2">
        {sources.length > 1 ? `All ${sources.length} sources →` : "Source details →"}
      </button>
    </div>
  );
}

/** Slide-over listing every source behind the current screen. */
export function SourcesPanel({ open, onClose, sources, searchHtml, screen }: {
  open: boolean; onClose: () => void; sources: Source[]; searchHtml?: string; screen?: string;
}) {
  const order: SourceKind[] = ["grants_gov", "your_input", "web", "template", "ai_generated"];
  const sorted = [...sources].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-[60] transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
      <aside aria-label="Sources" aria-hidden={!open}
        className={`sources-panel fixed top-0 left-0 h-screen w-[26rem] bg-white z-[61] shadow-2xl border-r border-slate-200 flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold truncate">{screen || "This screen"}</p>
            <h3 className="text-lg font-bold text-slate-900">Sources ({sources.length})</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl" aria-label="Close sources">&times;</button>
        </div>
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-x-3 gap-y-1">
          {order.filter((k) => sources.some((s) => s.kind === k)).map((k) => <SourceBadge key={k} kind={k} />)}
        </div>
        <ol className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {sorted.length === 0 && <p className="text-sm text-slate-400 text-center pt-12">No sources for this screen yet.</p>}
          {sorted.map((s, i) => (
            <li key={s.id} className="source-item rounded-xl border border-slate-200 p-3.5 flex gap-3">
              <span className={`shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1 rounded-md border text-[11px] font-bold ${meta(s.kind).chip}`}>{s.tag || i + 1}</span>
              <div className="min-w-0 flex-1">
                <SourceBadge kind={s.kind} />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="block text-sm font-semibold text-slate-900 hover:underline underline-offset-2 leading-snug mt-0.5">
                    {s.title} <span className="text-slate-400">↗</span>
                  </a>
                ) : (
                  <p className="text-sm font-semibold text-slate-900 leading-snug mt-0.5">{s.title}</p>
                )}
                {s.detail && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.detail}</p>}
                {s.supports && <p className="text-xs text-slate-600 mt-1.5"><span className="text-slate-400">Backs up:</span> {s.supports}</p>}
                {s.fetched_at && <p className="text-[10px] text-slate-400 mt-1">Fetched {timeAgo(s.fetched_at)}</p>}
              </div>
            </li>
          ))}
        </ol>
        {searchHtml && (
          <div className="border-t border-slate-100 px-4 pt-2 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Related Google searches</p>
            <SearchSuggestions html={searchHtml} />
          </div>
        )}
      </aside>
    </>
  );
}
