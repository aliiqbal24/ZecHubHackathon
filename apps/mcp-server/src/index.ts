import express from "express";
import cors from "cors";
import { callTool, toolDefinitions } from "./tools.js";

const PORT = Number(process.env.MCP_SERVER_PORT ?? 3010);
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "agentzcash-mcp-server" });
});

app.get("/mcp/tools", (_request, response) => {
  response.json({ tools: toolDefinitions });
});

app.post("/mcp/call", async (request, response) => {
  try {
    const name = String(request.body?.name ?? "");
    const args =
      typeof request.body?.args === "object" && request.body.args !== null
        ? (request.body.args as Record<string, unknown>)
        : {};
    const result = await callTool(name, args);
    response.json({ ok: true, result });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Tool call failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`AgentZcash MCP HTTP server listening on http://localhost:${PORT}`);
});
