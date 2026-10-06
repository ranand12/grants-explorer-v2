// Shared types for dashboard state — mirrors the session state keys the agent tools write.

// Citation for a screen / message (see agent/sources.py)
export type SourceKind = "grants_gov" | "web" | "your_input" | "template" | "ai_generated";

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  url?: string;
  detail?: string;
  fetched_at?: string;
  supports?: string;
  tag?: string; // draft citations: "S1", "S2", ...
}

export interface GrantData {
  source_url?: string;
  fetched_at?: string;
  opportunity_id?: string;
  opportunity_title: string;
  agency_name: string;
  agency_code?: string;
  top_level_agency_name?: string;
  opportunity_number: string;
  opportunity_status: string;
  award_floor: number | null;
  award_ceiling: number | null;
  estimated_total_program_funding: number | null;
  expected_number_of_awards: number | null;
  close_date: string | null;
  post_date: string | null;
  description: string;
  applicant_eligibility_description?: string;
  funding_categories: string[];
  funding_instruments: string[];
  applicant_types: string[];
  additional_info_url: string | null;
  agency_email: string | null;
  agency_contact_description?: string;
  is_cost_sharing: boolean | null;
  is_forecast?: boolean;
  attachments?: { file_name: string; file_description: string; download_path: string }[];
}


export interface GrantDraftSection {
  heading: string;
  content: string;
  pending?: boolean;
  citations?: string[];
  needs_evidence?: number;
}

export interface GrantDraftData {
  draft_id?: string;
  opportunity_title: string;
  opportunity_number: string;
  agency_name: string;
  organization_name: string;
  project_title: string;
  principal_investigator: string;
  generating?: boolean;
  sources?: Source[];
  sections: GrantDraftSection[];
}

export interface GrantStatsData {
  total_results: number;
  total_estimated_funding: number;
  total_expected_awards: number;
  min_award: number | null;
  max_award: number | null;
  funding_ranges: Record<string, number>;
  by_agency: Record<string, number>;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  by_applicant_type: Record<string, number>;
  by_instrument: Record<string, number>;
  sample_grants: { title: string; agency: string; ceiling: number | null }[];
}

export interface AgencyOverviewData {
  agency_code: string;
  agency_name: string;
  total_grants: number;
  total_estimated_funding: number;
  grants_by_category: Record<string, { title: string; number: string; status: string; ceiling: number | null; close_date: string | null }[]>;
  status_breakdown: Record<string, number>;
  applicant_types: Record<string, number>;
  funding_categories: Record<string, number>;
  sample_grants: GrantData[];
}

export interface EligibilityData {
  applicant_type: string;
  applicant_type_display: string;
  total_eligible: number;
  grants: GrantData[];
  by_agency: Record<string, number>;
  by_category: Record<string, number>;
  cost_sharing_breakdown: Record<string, number>;
}

export type DashboardType =
  | "grants" | "grant_draft" | "grant_detail" | "grant_stats" | "deadline_tracker"
  | "agency_overview" | "eligibility_match" | "a2ui" | "";

// A2UI v0.9 server-to-client messages (opaque here; validated by @a2ui/web_core)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type A2uiMessage = Record<string, any>;

export interface DashboardState {
  dashboard_type: DashboardType;
  grants_data: GrantData[];
  grant_draft: GrantDraftData | null;
  grant_detail: GrantData | null;
  grant_stats: GrantStatsData | null;
  deadline_grants: GrantData[];
  deadline_days: number;
  agency_data: AgencyOverviewData | null;
  eligibility_data: EligibilityData | null;
  a2ui_messages: A2uiMessage[] | null;
  last_query: string;
  sources: Source[];
  search_html: string; // Google Search Suggestions (required display when grounding is used)
}

export const EMPTY_DASHBOARD: DashboardState = {
  dashboard_type: "",
  grants_data: [],
  grant_draft: null,
  grant_detail: null,
  grant_stats: null,
  deadline_grants: [],
  deadline_days: 90,
  agency_data: null,
  eligibility_data: null,
  a2ui_messages: null,
  last_query: "",
  sources: [],
  search_html: "",
};

export interface ShortlistEntry {
  opportunity_title: string;
  opportunity_id?: string;
  opportunity_number?: string;
  agency_name?: string;
  award_floor?: number | null;
  award_ceiling?: number | null;
  close_date?: string | null;
  opportunity_status?: string;
  additional_info_url?: string | null;
  note?: string;
  saved_at?: string;
}

export type UserProfile = Record<string, string>;

export interface ToolActivity {
  id: string;
  name: string;
  label: string;
  status: "running" | "ok" | "no_results" | "error";
  startedAt: number;
}

/** Events tools publish on the backend ui_bus (delivered over /live or SSE). */
export type BusEvent =
  | ({ type: "dashboard" } & Partial<DashboardState>)
  | { type: "draft_section"; draft_id: string; index: number; section: GrantDraftSection }
  | { type: "shortlist"; shortlist: ShortlistEntry[] }
  | { type: "profile"; profile: UserProfile }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; name: string; status: ToolActivity["status"] };
