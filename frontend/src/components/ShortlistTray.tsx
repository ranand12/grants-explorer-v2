"use client";

// Slide-over tray with the user's saved grants (persisted server-side in
// ADK `user:` state, so it follows the user across conversations).

import { useState } from "react";
import type { ShortlistEntry } from "@/lib/types";
import { formatCompact, daysUntil } from "@/lib/format";
import { useUiAction } from "@/lib/actions";

export function ShortlistTray({ open, onClose, items }: { open: boolean; onClose: () => void; items: ShortlistEntry[] }) {
  const dispatch = useUiAction();
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t].slice(-4)));
  const sorted = [...items].sort((a, b) => (a.close_date || "9999").localeCompare(b.close_date || "9999"));

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-[60] transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
      <aside className={`fixed top-0 left-0 h-screen w-[24rem] bg-white z-[61] shadow-2xl border-r border-slate-200 flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Saved across sessions</p>
            <h3 className="text-lg font-bold text-slate-900">Your Shortlist</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl" aria-label="Close">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sorted.length === 0 && (
            <p className="text-sm text-slate-400 text-center pt-12 px-6">Nothing saved yet. Hit <span className="text-amber-600 font-semibold">&#9733; Save</span> on any grant, or say &ldquo;save this one&rdquo;.</p>
          )}
          {sorted.map((g) => {
            const days = daysUntil(g.close_date || null);
            const isSel = selected.includes(g.opportunity_title);
            return (
              <div key={g.opportunity_title} className={`rounded-xl border p-4 transition-colors ${isSel ? "border-emerald-400 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={isSel} onChange={() => toggle(g.opportunity_title)} className="mt-1 accent-emerald-600" aria-label="Select for comparison" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 leading-snug">{g.opportunity_title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{g.agency_name}{g.award_ceiling ? ` · up to ${formatCompact(g.award_ceiling)}` : ""}</p>
                    {g.close_date && (
                      <p className={`text-xs mt-1 font-medium ${days != null && days <= 30 ? "text-rose-600" : "text-slate-500"}`}>
                        Due {g.close_date}{days != null && days >= 0 ? ` · ${days}d left` : ""}
                      </p>
                    )}
                    {g.note && <p className="text-xs text-slate-500 italic mt-1">&ldquo;{g.note}&rdquo;</p>}
                    <div className="flex gap-1 mt-2">
                      <button onClick={() => { dispatch("show_grant_detail", { ...g }); onClose(); }} className="text-[11px] font-semibold px-2 py-0.5 rounded text-slate-600 hover:bg-slate-100">Details</button>
                      <button onClick={() => { dispatch("draft_proposal", { ...g }); onClose(); }} className="text-[11px] font-semibold px-2 py-0.5 rounded text-emerald-700 hover:bg-emerald-50">Draft</button>
                      <button onClick={() => dispatch("remove_from_shortlist", { opportunity_title: g.opportunity_title })} className="text-[11px] font-semibold px-2 py-0.5 rounded text-rose-600 hover:bg-rose-50 ml-auto">Remove</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-100">
          <button disabled={selected.length < 2} onClick={() => { dispatch("compare", { titles: selected }); onClose(); }}
            className="w-full text-sm font-semibold py-2.5 rounded-xl bg-slate-900 text-white disabled:opacity-30">
            Compare {selected.length >= 2 ? `${selected.length} grants` : "(select 2–4)"}
          </button>
        </div>
      </aside>
    </>
  );
}
