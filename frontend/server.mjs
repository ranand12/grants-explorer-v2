// Custom server: Next.js + a same-origin proxy to the Python agent.
//
//   /agent/*        → AGENT_URL/*   (REST, SSE event stream, and the /live WebSocket)
//   everything else → Next.js       (including its own HMR WebSocket in dev)
//
// Keeping the agent behind the app's origin means the browser never needs to
// reach port 8001 directly — required behind Cloud Workstations / Cloud Run
// proxies, and it removes CORS from the picture entirely.

import { createServer, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { WebSocketServer, WebSocket } from "ws";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const agent = new URL(process.env.AGENT_URL || "http://localhost:8001/");
const PREFIX = "/agent";
// Added server-side to /live so the token never reaches the browser
const liveToken = process.env.LIVE_AUTH_TOKEN || "";

const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();

const upstreamPath = (url) => url.slice(PREFIX.length) || "/";

function proxyHttp(req, res) {
  const send = agent.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = { ...req.headers, host: agent.host };
  delete headers.origin; // same-origin from the agent's point of view
  const up = send(
    { protocol: agent.protocol, hostname: agent.hostname, port: agent.port, method: req.method, path: upstreamPath(req.url), headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      res.flushHeaders(); // start SSE streams immediately
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => {
    console.error("Agent proxy error:", err.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "agent unreachable" }));
  });
  req.pipe(up);
}

app.prepare().then(() => {
  const nextUpgrade = app.getUpgradeHandler();
  const server = createServer((req, res) => {
    if (req.url === PREFIX || req.url.startsWith(PREFIX + "/")) return proxyHttp(req, res);
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith(PREFIX + "/")) return nextUpgrade(req, socket, head);

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const target = new URL(`${agent.protocol === "https:" ? "wss" : "ws"}://${agent.host}${upstreamPath(req.url)}`);
      if (liveToken) target.searchParams.set("token", liveToken);
      const upstream = new WebSocket(target, { maxPayload: 0 });
      const pending = [];

      clientWs.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else pending.push([data, isBinary]);
      });
      upstream.on("open", () => {
        for (const [data, isBinary] of pending.splice(0)) upstream.send(data, { binary: isBinary });
      });
      upstream.on("message", (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
      });
      // Relay close codes (e.g. 4401 auth) so the client's reconnect logic sees them
      upstream.on("close", (code, reason) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code >= 1000 && code !== 1005 && code !== 1006 ? code : 1011, reason);
      });
      upstream.on("error", (err) => {
        console.error("Agent WS error:", err.message);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, "agent unreachable");
      });
      clientWs.on("close", () => upstream.readyState <= WebSocket.OPEN && upstream.close());
      clientWs.on("error", () => upstream.readyState <= WebSocket.OPEN && upstream.close());
    });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port}`);
    console.log(`> ${PREFIX}/* (HTTP, SSE, WebSocket) proxied to ${agent.origin}`);
  });
});
