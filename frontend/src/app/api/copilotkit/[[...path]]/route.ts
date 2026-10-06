// CopilotKit API route — bridges the frontend chat to our Python agent.
// The agent lives at AGENT_URL and speaks the AG-UI protocol.

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8001/";

// Empty adapter because our agent handles everything — CopilotKit just proxies
const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    grants_advisor: new HttpAgent({ url: AGENT_URL }),
  },
});

const handler = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};

// GET serves /info (agent discovery) for newer CopilotKit clients
export const POST = handler;
export const GET = handler;
