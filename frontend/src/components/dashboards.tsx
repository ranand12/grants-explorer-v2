"use client";

// Classic dashboard views (v1 look & feel), now with actionable grant cards and
// a proposal document that streams sections in as Gemini writes them.

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GrantData, GrantDraftData, GrantStatsData, AgencyOverviewData, EligibilityData, Source } from "@/lib/types";
import { formatCurrency, formatCompact, stripHtml, prettyLabel, daysUntil } from "@/lib/format";
import { useUiAction } from "@/lib/actions";
import { CitationChip, SourceBadge, SourceLine, KIND } from "@/components/sources";

// ── Icons (inline SVG) ──

export function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Horizontal Bar Chart (reusable) ──

export function HorizontalBarChart({ data, color = "emerald", maxBars = 8 }: { data: Record<string, number>; color?: string; maxBars?: number }) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, maxBars);
  const max = sorted.length > 0 ? sorted[0][1] : 1;

  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    teal: "bg-teal-500",
    cyan: "bg-cyan-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };
  const barColor = colorMap[color] || "bg-emerald-500";

  return (
    <div className="space-y-2">
      {sorted.map(([label, count]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-xs text-slate-600 w-40 truncate text-right font-medium" title={prettyLabel(label)}>
            {prettyLabel(label)}
          </span>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div
              className={`${barColor} h-full rounded-full transition-all duration-700 flex items-center justify-end pr-2`}
              style={{ width: `${Math.max((count / max) * 100, 8)}%` }}
            >
              <span className="text-[10px] text-white font-bold">{count}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stat Pill ──

export function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Grant Card (reused across dashboards) ──

export function grantActionContext(grant: Partial<GrantData>) {
  return {
    opportunity_title: grant.opportunity_title,
    opportunity_id: grant.opportunity_id,
    opportunity_number: grant.opportunity_number,
    agency_name: grant.agency_name,
  };
}

export function GrantActions({ grant, compact = false }: { grant: Partial<GrantData>; compact?: boolean }) {
  const dispatch = useUiAction();
  const ctx = grantActionContext(grant);
  const btn = "text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors";
  return (
    <div className="flex items-center gap-1.5">
      {!compact && (
        <button onClick={() => dispatch("show_grant_detail", ctx)} className={`${btn} text-slate-600 hover:bg-slate-100`}>Details</button>
      )}
      <button onClick={() => dispatch("save_to_shortlist", ctx)} className={`${btn} text-amber-700 hover:bg-amber-50`} title="Save to shortlist">&#9733; Save</button>
      <button onClick={() => dispatch("draft_proposal", ctx)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Draft</button>
    </div>
  );
}

export function GrantCard({ grant }: { grant: GrantData }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    grant.opportunity_status === "posted" ? "bg-emerald-100 text-emerald-700" :
    grant.opportunity_status === "forecasted" ? "bg-amber-100 text-amber-700" :
    "bg-slate-100 text-slate-600";

  const days = daysUntil(grant.close_date);
  const deadlineColor = days != null && days <= 30 ? "text-rose-600 font-semibold" : "text-slate-600";

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 card-hover">
      <div className="h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-slate-900 text-sm leading-snug flex-1">{grant.opportunity_title}</h3>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusColor}`}>{grant.opportunity_status}</span>
        </div>
        <p className="text-xs text-slate-500 font-medium mb-3">{grant.agency_name}</p>
        <div className="flex flex-wrap gap-3 text-xs mb-3">
          <div>
            <span className="text-slate-400">Award Range</span>
            <p className="font-semibold text-slate-800">{formatCurrency(grant.award_floor)} &ndash; {formatCurrency(grant.award_ceiling)}</p>
          </div>
          {grant.close_date && (
            <div>
              <span className="text-slate-400">Deadline</span>
              <p className={`font-semibold ${deadlineColor}`}>
                {new Date(grant.close_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {days != null && days > 0 && <span className="text-slate-400 font-normal ml-1">({days}d)</span>}
              </p>
            </div>
          )}
          {grant.estimated_total_program_funding && (
            <div>
              <span className="text-slate-400">Total Funding</span>
              <p className="font-semibold text-slate-800">{formatCurrency(grant.estimated_total_program_funding)}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors">
            {expanded ? "Less" : "More"}
            <span className="transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}><IconChevron open={expanded} /></span>
          </button>
          <GrantActions grant={grant} />
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 animate-slide-down">
            {grant.description && <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{stripHtml(grant.description)}</p>}
            {grant.opportunity_number && <p className="text-xs text-slate-400">Opportunity #: <span className="text-slate-600">{grant.opportunity_number}</span></p>}
            {(grant.funding_categories || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {grant.funding_categories.map((cat) => (
                  <span key={cat} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{cat.replace(/_/g, " ")}</span>
                ))}
              </div>
            )}
            {grant.additional_info_url && (
              <a href={grant.additional_info_url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-emerald-600 hover:underline font-medium">View full listing &rarr;</a>
            )}
          </div>
        )}
      </div>
      {(grant.source_url || grant.fetched_at) && (
        <div className="px-5 py-2 border-t border-slate-50 bg-slate-50/50">
          <SourceLine url={grant.source_url} detail={grant.opportunity_number} fetchedAt={grant.fetched_at} />
        </div>
      )}
    </div>
  );
}

// ── Dashboard: Grant Detail ──

export function GrantDetailView({ grant }: { grant: GrantData }) {
  const days = daysUntil(grant.close_date);
  const urgencyColor = days != null ? (days <= 7 ? "bg-rose-500" : days <= 30 ? "bg-amber-500" : "bg-emerald-500") : "bg-slate-400";

  return (
    <div className="animate-fade-in">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Grant Detail</p>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">{grant.opportunity_title}</h2>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">{grant.agency_name} &middot; {grant.opportunity_number}</p>
        <GrantActions grant={grant} compact />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatPill label="Award Floor" value={formatCurrency(grant.award_floor)} />
        <StatPill label="Award Ceiling" value={formatCurrency(grant.award_ceiling)} />
        <StatPill label="Total Funding" value={formatCurrency(grant.estimated_total_program_funding)} />
        <StatPill label="Expected Awards" value={grant.expected_number_of_awards?.toString() || "N/A"} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-6">
        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500" />
        <div className="p-6 space-y-6">
          {grant.close_date && (
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${urgencyColor}`} />
              <div>
                <p className="text-xs text-slate-400 font-semibold">Application Deadline</p>
                <p className="text-sm font-semibold text-slate-900">
                  {new Date(grant.close_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  {days != null && days > 0 && <span className="text-slate-400 font-normal ml-2">({days} days remaining)</span>}
                </p>
              </div>
            </div>
          )}
          {grant.description && (
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-2">Description</p>
              <p className="text-sm text-slate-700 leading-relaxed">{stripHtml(grant.description)}</p>
            </div>
          )}
          {grant.applicant_eligibility_description && (
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-2">Eligibility</p>
              <p className="text-sm text-slate-700 leading-relaxed line-clamp-6">{stripHtml(grant.applicant_eligibility_description)}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            {(grant.applicant_types || []).length > 0 && (
              <div>
                <p className="text-xs text-slate-400 font-semibold mb-2">Eligible Applicants</p>
                <div className="flex flex-wrap gap-1">
                  {grant.applicant_types.map((t) => <span key={t} className="text-[10px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{prettyLabel(t)}</span>)}
                </div>
              </div>
            )}
            {(grant.funding_categories || []).length > 0 && (
              <div>
                <p className="text-xs text-slate-400 font-semibold mb-2">Categories</p>
                <div className="flex flex-wrap gap-1">
                  {grant.funding_categories.map((c) => <span key={c} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{prettyLabel(c)}</span>)}
                </div>
              </div>
            )}
            {(grant.funding_instruments || []).length > 0 && (
              <div>
                <p className="text-xs text-slate-400 font-semibold mb-2">Funding Type</p>
                <div className="flex flex-wrap gap-1">
                  {grant.funding_instruments.map((f) => <span key={f} className="text-[10px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full">{prettyLabel(f)}</span>)}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-6 text-xs">
            {grant.is_cost_sharing != null && (
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${grant.is_cost_sharing ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="text-slate-600">Cost Sharing: {grant.is_cost_sharing ? "Required" : "Not Required"}</span>
              </div>
            )}
            {grant.agency_email && <span className="text-slate-600">Contact: <a href={`mailto:${grant.agency_email}`} className="text-emerald-600 hover:underline">{grant.agency_email}</a></span>}
          </div>
          {grant.additional_info_url && (
            <a href={grant.additional_info_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-emerald-500/20 transition-all">
              View Full Listing &rarr;
            </a>
          )}
        </div>
        {(grant.source_url || grant.fetched_at) && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/60">
            <SourceLine url={grant.source_url} detail={`${grant.opportunity_number || "Official listing"} · every figure above is from this record`} fetchedAt={grant.fetched_at} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard: Grant Stats ──

export function GrantStatsView({ stats, query }: { stats: GrantStatsData; query: string }) {
  return (
    <div className="animate-fade-in">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Grants Landscape</p>
      <h2 className="text-3xl font-bold text-slate-900 mb-8">{query}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatPill label="Total Grants" value={stats.total_results.toLocaleString()} />
        <StatPill label="Est. Total Funding" value={stats.total_estimated_funding > 0 ? formatCompact(stats.total_estimated_funding) : "N/A"} sub="across results shown" />
        <StatPill label="Award Range" value={stats.min_award && stats.max_award ? `${formatCompact(stats.min_award)} - ${formatCompact(stats.max_award)}` : "Varies"} />
        <StatPill label="Expected Awards" value={stats.total_expected_awards > 0 ? stats.total_expected_awards.toLocaleString() : "N/A"} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {Object.keys(stats.by_agency).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">By Agency</h3>
            <HorizontalBarChart data={stats.by_agency} color="emerald" />
          </div>
        )}
        {Object.keys(stats.by_category).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">By Category</h3>
            <HorizontalBarChart data={stats.by_category} color="teal" />
          </div>
        )}
        {Object.keys(stats.by_status).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">By Status</h3>
            <HorizontalBarChart data={stats.by_status} color="cyan" />
          </div>
        )}
        {Object.keys(stats.funding_ranges).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Award Size Distribution</h3>
            <HorizontalBarChart data={stats.funding_ranges} color="amber" />
          </div>
        )}
      </div>
      {stats.sample_grants.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Top Matching Grants</h3>
          <div className="space-y-3">
            {stats.sample_grants.map((g, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-800">{g.title}</p>
                  <p className="text-xs text-slate-400">{g.agency}</p>
                </div>
                {g.ceiling && <span className="text-xs font-semibold text-emerald-600">up to {formatCompact(g.ceiling)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard: Deadline Tracker ──

export function DeadlineTrackerView({ grants, days: daysAhead, query }: { grants: GrantData[]; days: number; query: string }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-end gap-4 mb-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Deadline Tracker</p>
          <h2 className="text-3xl font-bold text-slate-900">{query}</h2>
        </div>
        <span className="text-xs px-3 py-1.5 rounded-full font-semibold mb-1 bg-rose-50 text-rose-700 border border-rose-200">
          Next {daysAhead} days &middot; {grants.length} grant{grants.length !== 1 ? "s" : ""}
        </span>
      </div>
      {grants.length === 0 && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-slate-600 font-medium">Nothing closes in this window.</p>
          <p className="text-sm text-slate-400 mt-1">Try a longer range (&ldquo;next 90 days&rdquo;) or a broader agency — many programs use rolling or standard due dates.</p>
        </div>
      )}
      <div className="space-y-3">
        {grants.map((grant, i) => {
          const d = daysUntil(grant.close_date);
          const urgency = d != null ? (d <= 7 ? "border-l-rose-500 bg-rose-50/30" : d <= 30 ? "border-l-amber-500 bg-amber-50/20" : "border-l-emerald-500") : "border-l-slate-300";
          const urgencyDot = d != null ? (d <= 7 ? "bg-rose-500" : d <= 30 ? "bg-amber-500" : "bg-emerald-500") : "bg-slate-400";
          const urgencyText = d != null ? (d <= 7 ? "text-rose-600" : d <= 30 ? "text-amber-600" : "text-emerald-600") : "text-slate-500";
          return (
            <div key={`${grant.opportunity_number}-${i}`} className={`bg-white rounded-xl border border-slate-100 shadow-sm border-l-4 ${urgency} p-5 card-hover`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 text-sm mb-1">{grant.opportunity_title}</h3>
                  <p className="text-xs text-slate-500 mb-2">{grant.agency_name} &middot; {grant.opportunity_number}</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-slate-600">Award: {formatCurrency(grant.award_floor)} &ndash; {formatCurrency(grant.award_ceiling)}</span>
                    {grant.estimated_total_program_funding && <span className="text-slate-600">Total: {formatCurrency(grant.estimated_total_program_funding)}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${urgencyDot} animate-pulse`} />
                    <span className={`text-lg font-bold ${urgencyText}`}>{d == null ? "—" : d > 0 ? `${d}d` : d === 0 ? "Today" : "Closed"}</span>
                  </div>
                  {grant.close_date && (
                    <p className="text-[10px] text-slate-400">
                      {new Date(grant.close_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard: Agency Overview ──

export function AgencyOverviewView({ data }: { data: AgencyOverviewData }) {
  return (
    <div className="animate-fade-in">
      <div className="bg-gradient-to-r from-emerald-700 to-teal-600 rounded-2xl p-8 mb-8 text-white">
        <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-200 font-semibold mb-2">Agency Profile</p>
        <h2 className="text-3xl font-bold mb-2">{data.agency_name}</h2>
        <div className="flex flex-wrap gap-6 mt-4 text-sm">
          <div>
            <p className="text-emerald-200 text-xs">Total Grants</p>
            <p className="text-xl font-bold">{data.total_grants.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-emerald-200 text-xs">Est. Total Funding</p>
            <p className="text-xl font-bold">{data.total_estimated_funding > 0 ? formatCompact(data.total_estimated_funding) : "N/A"}</p>
          </div>
          {Object.keys(data.status_breakdown).length > 0 && (
            <div>
              <p className="text-emerald-200 text-xs">Status</p>
              <div className="flex gap-3 mt-1">
                {Object.entries(data.status_breakdown).map(([status, count]) => (
                  <span key={status} className="text-sm"><span className="font-bold">{count}</span> <span className="text-emerald-200">{prettyLabel(status)}</span></span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {Object.keys(data.funding_categories).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Funding Categories</h3>
            <HorizontalBarChart data={data.funding_categories} color="emerald" />
          </div>
        )}
        {Object.keys(data.applicant_types).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Eligible Applicant Types</h3>
            <HorizontalBarChart data={data.applicant_types} color="teal" />
          </div>
        )}
      </div>
      {Object.keys(data.grants_by_category).length > 0 && (
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-slate-900">Programs by Category</h3>
          {Object.entries(data.grants_by_category).map(([category, grants]) => (
            <div key={category} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
              <div className="p-5">
                <h4 className="text-sm font-bold text-slate-900 mb-3">{category} <span className="text-slate-400 font-normal">({grants.length})</span></h4>
                <div className="space-y-2">
                  {grants.map((g, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                      <div>
                        <p className="text-xs font-medium text-slate-800">{g.title}</p>
                        <p className="text-[10px] text-slate-400">{g.number}</p>
                      </div>
                      <div className="text-right">
                        {g.ceiling && <span className="text-[10px] font-semibold text-emerald-600">up to {formatCompact(g.ceiling)}</span>}
                        <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${g.status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{g.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard: Eligibility Match ──

export function EligibilityMatchView({ data }: { data: EligibilityData }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-end gap-4 mb-8">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Eligibility Match</p>
          <h2 className="text-3xl font-bold text-slate-900">Grants for {data.applicant_type_display}</h2>
        </div>
        <span className="text-xs px-3 py-1.5 rounded-full font-semibold mb-1 bg-teal-50 text-teal-700 border border-teal-200">
          {data.total_eligible.toLocaleString()} eligible
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {Object.keys(data.by_agency).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">By Agency</h3>
            <HorizontalBarChart data={data.by_agency} color="emerald" />
          </div>
        )}
        {Object.keys(data.by_category).length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">By Category</h3>
            <HorizontalBarChart data={data.by_category} color="teal" />
          </div>
        )}
      </div>
      {Object.keys(data.cost_sharing_breakdown).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-8">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Cost Sharing Requirements</h3>
          <div className="flex gap-4">
            {Object.entries(data.cost_sharing_breakdown).map(([key, count]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${key === "true" ? "bg-amber-400" : "bg-emerald-400"}`} />
                <span className="text-sm text-slate-700">{key === "true" ? "Required" : "Not Required"}: <span className="font-semibold">{count}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 stagger-children">
        {data.grants.map((g, i) => <GrantCard key={`${g.opportunity_number}-${i}`} grant={g} />)}
      </div>
    </div>
  );
}

// ── Draft citations ──
// Section writers tag claims with [S1]… (numbered sources on draft.sources) and
// wrap specific claims nothing supports in [[…]]. Both become markdown links
// the renderer turns into chips / amber "needs evidence" marks.

const TAG = /\[(S\d+)\](?!\()/g;
const FLAG = /\[\[([\s\S]+?)\]\]/g;
const GROUP = /\[(S\d+(?:\s*[,;]\s*S\d+)+)\]/g; // [S1, S2] → [S1][S2]
const ungroup = (md: string) => md.replace(GROUP, (_, g: string) => g.split(/[,;]/).map((t) => `[${t.trim()}]`).join(""));

const citeMarkdown = (md: string) =>
  ungroup(md).replace(FLAG, (_, claim) => `[${claim.replace(/[[\]]/g, "")}](#needs-evidence)`).replace(TAG, "[$1](#cite-$1)");

// Export: [S1] → footnote [^S1], [[claim]] → "claim [NEEDS EVIDENCE]"
const exportMarkdown = (md: string) => ungroup(md).replace(FLAG, "$1 [NEEDS EVIDENCE]").replace(TAG, "[^$1]");

function draftLink(byTag: Record<string, Source>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function A({ href, children }: { href?: string; children?: any }) {
    if (href?.startsWith("#cite-")) {
      const tag = href.slice(6);
      return <CitationChip n={tag.slice(1)} source={byTag[tag]} />;
    }
    if (href === "#needs-evidence") {
      return (
        <mark className="needs-evidence bg-amber-100/80 text-inherit rounded px-0.5 border-b-2 border-dashed border-amber-400 cursor-help"
          title="Needs evidence: no source backs this specific claim. Add a citation or your own data before submitting.">
          {children}
        </mark>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  };
}

// ── Grant Draft Document ──
// Sections arrive one by one (draft_section events) while the voice agent keeps
// talking. Pending sections show a shimmer; finished ones render as Markdown.

export function GrantDraftDocument({ draft }: { draft: GrantDraftData }) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setEdits({}); setEditingIdx(null); }, [draft.draft_id, draft.opportunity_title]);
  useEffect(() => {
    if (editingIdx !== null && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = "auto";
      editRef.current.style.height = editRef.current.scrollHeight + "px";
    }
  }, [editingIdx]);

  const sections = draft.sections.map((s, i) => ({ ...s, content: edits[i] ?? s.content }));
  const done = sections.filter((s) => !s.pending).length;
  const pct = Math.round((done / Math.max(sections.length, 1)) * 100);

  const draftSources = draft.sources || [];
  const tagged = draftSources.filter((s) => s.tag);
  const byTag = Object.fromEntries(tagged.map((s) => [s.tag!, s]));
  const mdComponents = { a: draftLink(byTag) };
  const needsEvidence = sections.reduce((n, s) => n + (s.pending ? 0 : s.needs_evidence || 0), 0);
  const citedTags = new Set(sections.flatMap((s) => s.citations || []));

  const exportText = () => {
    const body = sections.map((s) => `## ${s.heading}\n\n${exportMarkdown(s.content)}`).join("\n\n---\n\n");
    const notes = tagged.filter((s) => citedTags.has(s.tag!))
      .map((s) => `[^${s.tag}]: ${s.title}${s.detail ? ` — ${s.detail}` : ""}${s.url ? ` (${s.url})` : ""}`).join("\n");
    return notes ? `${body}\n\n---\n\n## Sources\n\n${notes}\n` : body;
  };
  const download = () => {
    const blob = new Blob([`# ${draft.project_title || draft.opportunity_title}\n\n${exportText()}`], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(draft.project_title || draft.opportunity_title).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">Grant Application Draft</p>
          <h2 className="text-2xl font-bold text-slate-900">{draft.project_title || draft.opportunity_title}</h2>
          <p className="text-sm text-slate-500 mt-1">{draft.agency_name} &middot; {draft.opportunity_number}</p>
          {!draft.generating && done > 0 && (tagged.length > 0) && (
            <p className="draft-summary text-xs text-slate-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><span className="font-semibold text-slate-700">{citedTags.size}</span> of {tagged.length} sources cited</span>
              {needsEvidence > 0 ? (
                <a href="#draft-sources" className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                  <span className="w-2 h-2 rounded-sm bg-amber-300 border border-amber-500" />
                  {needsEvidence} claim{needsEvidence === 1 ? "" : "s"} need evidence
                </a>
              ) : <span className="text-emerald-700 font-semibold">✓ every specific claim is sourced</span>}
            </p>
          )}
        </div>
        <span className={`text-xs px-3 py-1.5 rounded-full font-semibold mb-1 border ${draft.generating ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
          {draft.generating ? `Writing… ${done}/${sections.length}` : `${sections.length} sections`}
        </span>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="h-1.5 bg-slate-100">
          <div className="h-full bg-gradient-to-r from-emerald-600 via-teal-500 to-violet-500 transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="divide-y divide-slate-100">
          {sections.map((section, idx) => (
            <div key={idx} className="group">
              <div className="px-8 py-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${section.pending ? "bg-violet-100 text-violet-600 animate-pulse" : "bg-emerald-100 text-emerald-700"}`}>{idx + 1}</span>
                    {section.heading}
                  </h3>
                  {!section.pending && editingIdx !== idx && ((section.citations?.length || 0) > 0 || (section.needs_evidence || 0) > 0) && (
                    <span className="section-cites ml-auto mr-2 flex items-center gap-1 text-[11px] text-slate-400">
                      {(section.citations || []).map((t) => <CitationChip key={t} n={t.slice(1)} source={byTag[t]} />)}
                      {(section.needs_evidence || 0) > 0 && <span className="text-amber-700 font-semibold ml-1">· {section.needs_evidence} need evidence</span>}
                    </span>
                  )}
                  {!section.pending && (
                    <button onClick={() => setEditingIdx(editingIdx === idx ? null : idx)} className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-emerald-600 hover:text-emerald-700 font-medium px-3 py-1 rounded-lg hover:bg-emerald-50">
                      {editingIdx === idx ? "Done" : "Edit"}
                    </button>
                  )}
                </div>
                {section.pending ? (
                  <div className="space-y-2">
                    {[92, 100, 85, 70].map((w, i) => <div key={i} className="h-3 rounded shimmer" style={{ width: `${w}%` }} />)}
                    <p className="text-[11px] text-violet-500 font-medium pt-1">Gemini is writing this section…</p>
                  </div>
                ) : editingIdx === idx ? (
                  <textarea ref={editRef} value={section.content}
                    onChange={(e) => { setEdits({ ...edits, [idx]: e.target.value }); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                    className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-emerald-300 font-mono leading-relaxed resize-none min-h-[120px]" />
                ) : (
                  <div className="prose-draft animate-fade-in"><ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{citeMarkdown(section.content)}</ReactMarkdown></div>
                )}
              </div>
            </div>
          ))}
        </div>
        {tagged.length > 0 && (
          <div id="draft-sources" className="draft-sources px-8 py-5 border-t border-slate-200">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">Sources</p>
            <ol className="space-y-2">
              {tagged.map((s) => (
                <li key={s.id} className={`flex items-start gap-3 text-xs ${citedTags.has(s.tag!) || draft.generating ? "" : "opacity-50"}`}>
                  <span className={`shrink-0 inline-flex items-center justify-center w-6 h-5 rounded border font-bold text-[10px] ${KIND[s.kind].chip}`}>{s.tag!.slice(1)}</span>
                  <div className="min-w-0">
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 hover:underline">{s.title} ↗</a>
                      : <span className="font-semibold text-slate-800">{s.title}</span>}
                    <span className="ml-2"><SourceBadge kind={s.kind} /></span>
                    {s.detail && <p className="text-slate-500 mt-0.5 line-clamp-1">{s.detail}</p>}
                  </div>
                </li>
              ))}
              {draftSources.filter((s) => !s.tag && s.kind !== "ai_generated").map((s) => (
                <li key={s.id} className="flex items-start gap-3 text-xs">
                  <span className={`shrink-0 inline-flex items-center justify-center w-6 h-5 rounded border font-bold text-[10px] ${KIND[s.kind].chip}`}>·</span>
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800">{s.title}</span>
                    <span className="ml-2"><SourceBadge kind={s.kind} /></span>
                    {s.supports && <p className="text-slate-500 mt-0.5">{s.supports} (not cited as evidence)</p>}
                  </div>
                </li>
              ))}
              <li className="flex items-start gap-3 text-xs">
                <span className="shrink-0 inline-flex items-center justify-center w-6 h-5 rounded border border-amber-400 bg-amber-100 font-bold text-[10px] text-amber-700">!</span>
                <p className="text-slate-500"><span className="bg-amber-100/80 border-b-2 border-dashed border-amber-400 px-0.5">Highlighted</span> text is a specific claim no source backs up. Everything uncited is AI-written; review it before relying on it.</p>
              </li>
            </ol>
          </div>
        )}
        <div className="px-8 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">AI-written first draft grounded in the official listing. Fill in [bracketed] items and verify against the NOFO.</p>
          <div className="flex gap-2">
            <button disabled={draft.generating} onClick={download} className="text-xs font-semibold text-slate-600 px-4 py-2 rounded-xl hover:bg-slate-200 disabled:opacity-40">Download .md</button>
            <button disabled={draft.generating} onClick={() => { navigator.clipboard.writeText(exportText()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 px-4 py-2 rounded-xl hover:bg-emerald-100 disabled:opacity-40">{copied ? "Copied ✓" : "Copy"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
