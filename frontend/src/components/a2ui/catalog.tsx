"use client";

// Grants A2UI catalog = the A2UI v0.9 basic catalog + domain components.
// Component names/props must match agent/a2ui_builder.py (CATALOG_ID too).

import { useState } from "react";
import { z } from "zod";
import { Catalog, CommonSchemas } from "@a2ui/web_core/v0_9";
import { BASIC_FUNCTIONS } from "@a2ui/web_core/v0_9/basic_catalog";
import { basicCatalog, createComponentImplementation, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import ReactMarkdown from "react-markdown";
import { formatCompact, daysUntil } from "@/lib/format";
import { SourceLine } from "@/components/sources";

export const CATALOG_ID = "https://grants-explorer.dev/a2ui/catalogs/grants/v1";

const Action = CommonSchemas.Action.optional();

// ── GrantCard ──

const GrantCardApi = {
  name: "GrantCard",
  schema: z.object({
    title: z.string(),
    agency: z.string().optional(),
    number: z.string().optional(),
    status: z.string().optional(),
    floor: z.number().optional(),
    ceiling: z.number().optional(),
    closeDate: z.string().optional(),
    url: z.string().optional(),
    sourceUrl: z.string().optional(),
    fetchedAt: z.string().optional(),
    onDetails: Action,
    onSave: Action,
    onDraft: Action,
  }),
};

const GrantCard = createComponentImplementation(GrantCardApi, ({ props }) => {
  const days = daysUntil(props.closeDate || null);
  const range =
    props.floor || props.ceiling
      ? `${props.floor ? formatCompact(props.floor) : "?"} – ${props.ceiling ? formatCompact(props.ceiling) : "?"}`
      : "Amount TBD";
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 card-hover flex-1 min-w-[240px]">
      <div className="h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-semibold text-slate-900 text-sm leading-snug">{props.title}</h4>
          {props.status && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${props.status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {props.status}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">{props.agency}{props.number ? ` · ${props.number}` : ""}</p>
        <div className="flex gap-4 text-xs mb-3">
          <div><span className="text-slate-400">Award</span><p className="font-semibold text-slate-800">{range}</p></div>
          {props.closeDate && (
            <div>
              <span className="text-slate-400">Deadline</span>
              <p className={`font-semibold ${days != null && days <= 30 ? "text-rose-600" : "text-slate-800"}`}>
                {props.closeDate}{days != null && days > 0 ? <span className="text-slate-400 font-normal"> ({days}d)</span> : null}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {props.onDetails && <button onClick={props.onDetails} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-slate-600 hover:bg-slate-100">Details</button>}
          {props.onSave && <button onClick={props.onSave} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-amber-700 hover:bg-amber-50">&#9733; Save</button>}
          {props.onDraft && <button onClick={props.onDraft} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Draft</button>}
          {props.url && <a href={props.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-emerald-600 hover:underline">Listing &rarr;</a>}
        </div>
      </div>
      {(props.sourceUrl || props.fetchedAt) && (
        <div className="px-4 py-2 border-t border-slate-50 bg-slate-50/50">
          <SourceLine url={props.sourceUrl} detail={props.number} fetchedAt={props.fetchedAt} />
        </div>
      )}
    </div>
  );
});

// ── Metric ──

const MetricApi = {
  name: "Metric",
  schema: z.object({ label: z.string(), value: z.string(), caption: z.string().optional() }),
};

const Metric = createComponentImplementation(MetricApi, ({ props }) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex-1 min-w-[150px]">
    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">{props.label}</p>
    <p className="text-2xl font-bold text-slate-900">{props.value}</p>
    {props.caption && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{props.caption}</p>}
  </div>
));

// ── BarChart ──

const BarChartApi = {
  name: "BarChart",
  schema: z.object({
    title: z.string().optional(),
    bars: z.array(z.object({ label: z.string(), value: z.number() })),
  }),
};

const BarChart = createComponentImplementation(BarChartApi, ({ props }) => {
  const bars = [...(props.bars || [])].sort((a, b) => b.value - a.value);
  const max = bars[0]?.value || 1;
  const fmt = (v: number) => (v >= 10_000 ? formatCompact(v) : v.toLocaleString());
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      {props.title && <h4 className="text-sm font-bold text-slate-900 mb-4">{props.title}</h4>}
      <div className="space-y-2">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="text-xs text-slate-600 w-40 truncate text-right font-medium" title={b.label}>{b.label}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full rounded-full flex items-center justify-end pr-2 bar-grow"
                style={{ width: `${Math.max((b.value / max) * 100, 8)}%` }}>
                <span className="text-[10px] text-white font-bold">{fmt(b.value)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── Callout ──

const CalloutApi = {
  name: "Callout",
  schema: z.object({
    tone: z.enum(["info", "success", "warning"]).optional(),
    title: z.string().optional(),
    text: z.string(),
  }),
};

const TONES = {
  info: "bg-sky-50 border-sky-200 text-sky-900",
  success: "bg-emerald-50 border-emerald-200 text-emerald-900",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
};

const Callout = createComponentImplementation(CalloutApi, ({ props }) => (
  <div className={`rounded-2xl border px-5 py-4 ${TONES[props.tone || "info"]}`}>
    {props.title && <p className="text-sm font-bold mb-1">{props.title}</p>}
    <div className="text-sm leading-relaxed prose-callout"><ReactMarkdown>{props.text}</ReactMarkdown></div>
  </div>
));

// ── Checklist (locally checkable) ──

const ChecklistApi = {
  name: "Checklist",
  schema: z.object({ title: z.string().optional(), items: z.array(z.string()) }),
};

function ChecklistView({ title, items }: { title?: string; items: string[] }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const count = Object.values(done).filter(Boolean).length;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        {title && <h4 className="text-sm font-bold text-slate-900">{title}</h4>}
        <span className="text-[11px] text-slate-400 font-semibold">{count}/{items.length}</span>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i}>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" checked={!!done[i]} onChange={() => setDone({ ...done, [i]: !done[i] })}
                className="mt-0.5 w-4 h-4 accent-emerald-600" />
              <span className={`text-sm leading-snug ${done[i] ? "line-through text-slate-400" : "text-slate-700"}`}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const Checklist = createComponentImplementation(ChecklistApi, ({ props }) => (
  <ChecklistView title={props.title} items={(props.items || []).map(String)} />
));

// ── CompareTable ──

const CompareTableApi = {
  name: "CompareTable",
  schema: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })),
  }),
};

const CompareTable = createComponentImplementation(CompareTableApi, ({ props }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-slate-50">
          <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest text-slate-400 font-semibold w-44" />
          {(props.columns || []).map(String).map((c, i) => (
            <th key={i} className="text-left px-4 py-3 font-semibold text-slate-900 align-top">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.label} className="border-t border-slate-100">
            <td className="px-4 py-2.5 text-xs text-slate-500 font-semibold">{r.label}</td>
            {r.values.map((v, i) => <td key={i} className="px-4 py-2.5 text-slate-700">{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
));

const CUSTOM = [GrantCard, Metric, BarChart, Callout, Checklist, CompareTable];

export const grantsCatalog = new Catalog<ReactComponentImplementation>(
  CATALOG_ID,
  [...Array.from(basicCatalog.components.values()), ...CUSTOM],
  BASIC_FUNCTIONS,
);
