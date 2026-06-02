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
    description: "Request a quote and create a dashboard approval request.",
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
  "prepare_zec_payment",
  {
    title: "Prepare Generic ZEC Payment",
    description: "Prepare a generic ZEC payment from a ZIP-321 URI or raw address, amount, and memo.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false
    },
    inputSchema: {
      paymentUri: z.string().optional(),
      address: z.string().optional(),
      amountZec: z.string().optional(),
      memo: z.string().optional(),
      recipientLabel: z.string().optional(),
      expiresAt: z.string().optional()
    }
  },
  async ({ paymentUri, address, amountZec, memo, recipientLabel, expiresAt }) =>
    textResult(await callTool("prepare_zec_payment", { paymentUri, address, amountZec, memo, recipientLabel, expiresAt }))
);

server.registerTool(
  "start_web_purchase",
  {
    title: "Start Web Purchase",
    description: "Start a vendor-agnostic web checkout or P2P ZEC purchase session, extract an invoice, and create an approval request without sending funds.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    inputSchema: {
      request: z.string(),
      targetUrl: z.string().url().optional(),
      vendorHint: z.string().optional(),
      productConstraints: z.record(z.string(), z.unknown()).optional(),
      checkoutHtml: z.string().optional()
    }
  },
  async ({ request, targetUrl, vendorHint, productConstraints, checkoutHtml }) =>
    textResult(await callTool("start_web_purchase", { request, targetUrl, vendorHint, productConstraints, checkoutHtml }))
);

server.registerTool(
  "review_purchase",
  {
    title: "Review Purchase",
    description: "Review exact amount, recipient, memo, policy checks, privacy/PII, expiry, and approval wording.",
    annotations: {
      readOnlyHint: false
    },
    inputSchema: {
      purchaseId: z.string()
    }
  },
  async ({ purchaseId }) => textResult(await callTool("review_purchase", { purchaseId }))
);

server.registerTool(
  "approve_and_pay_purchase",
  {
    title: "Approve And Pay Purchase",
    description: "Submit the ZEC payment after explicit user approval. Destructive, non-idempotent, and open-world.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    inputSchema: {
      purchaseId: z.string(),
      overrideReason: z.string().optional(),
      profileId: z.string().optional()
    }
  },
  async ({ purchaseId, overrideReason, profileId }) =>
    textResult(await callTool("approve_and_pay_purchase", { purchaseId, overrideReason, profileId }))
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
  "get_zecguard_state",
  {
    title: "Get ZecGuard State",
    description: "Inspect purchases, wallet state, activity, and receipts.",
    annotations: {
      readOnlyHint: true
    },
    inputSchema: {}
  },
  async () => textResult(await callTool("get_zecguard_state", {}))
);

server.registerTool(
  "get_agent_wallet_status",
  {
    title: "Get Agent Wallet Status",
    description: "Inspect the dedicated agent spending wallet status, deposit address, and spendable balance.",
    annotations: {
      readOnlyHint: true
    },
    inputSchema: {}
  },
  async () => textResult(await callTool("get_agent_wallet_status", {}))
);

const transport = new StdioServerTransport();
await server.connect(transport);
