import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callTool } from "./tools.js";

const server = new McpServer({
  name: "zecguard",
  version: "0.1.0"
});

function textResult(result: unknown) {
  const structuredContent =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { value: result };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent
  };
}

server.registerTool(
  "discover_zec_vendor",
  {
    title: "Discover ZEC Vendor",
    description: "Read a vendor's ZEC Harness manifest and products.",
    inputSchema: {
      url: z.string().url()
    }
  },
  async ({ url }) => textResult(await callTool("discover_zec_vendor", { url }))
);

server.registerTool(
  "request_quote",
  {
    title: "Request ZEC Quote",
    description: "Request a quote and create a dashboard approval request.",
    inputSchema: {
      vendorUrl: z.string().url(),
      itemId: z.string(),
      options: z.record(z.string(), z.unknown()).optional()
    }
  },
  async ({ vendorUrl, itemId, options }) =>
    textResult(await callTool("request_quote", { vendorUrl, itemId, options }))
);

server.registerTool(
  "prepare_purchase",
  {
    title: "Prepare Purchase",
    description: "Refresh policy checks for a pending purchase.",
    inputSchema: {
      purchaseId: z.string()
    }
  },
  async ({ purchaseId }) => textResult(await callTool("prepare_purchase", { purchaseId }))
);

server.registerTool(
  "claim_fulfillment",
  {
    title: "Claim Fulfillment",
    description: "Check vendor fulfillment and store the private receipt.",
    inputSchema: {
      purchaseId: z.string()
    }
  },
  async ({ purchaseId }) => textResult(await callTool("claim_fulfillment", { purchaseId }))
);

server.registerTool(
  "get_zecguard_state",
  {
    title: "Get ZecGuard State",
    description: "Inspect purchases, wallet state, activity, and receipts.",
    inputSchema: {}
  },
  async () => textResult(await callTool("get_zecguard_state", {}))
);

const transport = new StdioServerTransport();
await server.connect(transport);
