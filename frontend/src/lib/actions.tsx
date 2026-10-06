"use client";

// One action pipe for every clickable thing on the dashboard (classic views and
// A2UI surfaces). In voice mode actions go over the /live WebSocket as
// {type:"ui_action"}; in text mode they become a chat message to the agent.

import { createContext, useContext } from "react";

export type UiActionContext = Record<string, unknown>;
export type UiActionDispatch = (name: string, context: UiActionContext) => void;

export const ActionContext = createContext<UiActionDispatch>(() => {});
export const useUiAction = () => useContext(ActionContext);

export function actionToText(name: string, ctx: UiActionContext): string {
  const t = String(ctx.opportunity_title ?? "this grant");
  const id = ctx.opportunity_id ? ` (opportunity_id ${ctx.opportunity_id})` : "";
  switch (name) {
    case "show_grant_detail":
      return `Show me the full details for "${t}"${id}.`;
    case "save_to_shortlist":
      return `Save "${t}"${id} to my shortlist.`;
    case "remove_from_shortlist":
      return `Remove "${t}" from my shortlist.`;
    case "draft_proposal":
      return `I want to draft a proposal for "${t}" (${ctx.opportunity_number ?? ""}, ${ctx.agency_name ?? ""})${id}.`;
    case "compare":
      return `Compare these grants: ${(ctx.titles as string[] | undefined)?.join("; ")}.`;
    default:
      return `[UI ACTION] ${name}: ${JSON.stringify(ctx)}`;
  }
}
