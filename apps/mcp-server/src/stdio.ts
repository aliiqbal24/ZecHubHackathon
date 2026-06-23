import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callTool } from "./tools.js";

const server = new McpServer({
  name: "agentzcash",
  version: "0.2.0"
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
    annotations: {
      readOnlyHint: true
    },
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
    description: "Request a quote, then submit payment when policy allows or create a dashboard approval request.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false
    },
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
  "prepare_direct_transfer",
  {
    title: "Prepare Direct Transfer",
    description: "Prepare a direct ZEC transfer, then submit payment when policy allows or create a dashboard approval request.",
    inputSchema: {
      recipientName: z.string(),
      amountZec: z.string(),
      address: z.string(),
      memo: z.string().optional(),
      purpose: z.string().optional(),
      evidenceUrls: z.array(z.string().url()).optional(),
      agentVerificationNotes: z.string().optional()
    }
  },
  async (args) => textResult(await callTool("prepare_direct_transfer", args))
);

server.registerTool(
  "claim_fulfillment",
  {
    title: "Claim Fulfillment",
    description: "Check vendor fulfillment and store the private receipt.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: true
    },
    inputSchema: {
      purchaseId: z.string()
    }
  },
  async ({ purchaseId }) => textResult(await callTool("claim_fulfillment", { purchaseId }))
);

server.registerTool(
  "get_agentzcash_state",
  {
    title: "Get AgentZcash State",
    description: "Inspect purchases, wallet state, activity, and receipts.",
    annotations: {
      readOnlyHint: true
    },
    inputSchema: {}
  },
  async () => textResult(await callTool("get_agentzcash_state", {}))
);

const transport = new StdioServerTransport();
await server.connect(transport);
