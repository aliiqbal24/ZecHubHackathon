import { z } from "zod";

const privacyDisclosureSchema = z.object({
  label: z.string(),
  grade: z.enum(["strong", "medium", "weak"]),
  leaks: z.array(z.string()),
  summary: z.string()
});

export const harnessManifestSchema = z.object({
  name: z.string(),
  vendorUrl: z.string().url(),
  version: z.string(),
  description: z.string(),
  zecHarness: z.object({
    quoteUrl: z.string().url(),
    orderUrl: z.string().url(),
    verifyUrlTemplate: z.string().optional(),
    receiptPublicKey: z.string(),
    supportedFulfillment: z.array(z.enum(["digital", "physical", "service"]))
  }),
  privacy: privacyDisclosureSchema,
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      fulfillmentType: z.enum(["digital", "physical", "service"]),
      basePriceZec: z.string(),
      requiresPii: z.array(z.string())
    })
  )
});

export const quoteRequestSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().positive().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  shippingProfile: z.record(z.string(), z.unknown()).optional()
});

export const quoteResponseSchema = z.object({
  quoteId: z.string(),
  vendorUrl: z.string().url(),
  vendorName: z.string(),
  itemId: z.string(),
  itemTitle: z.string(),
  amountZec: z.string(),
  expiresAt: z.string(),
  terms: z.array(z.string()),
  requiredPii: z.array(z.string()),
  fulfillmentType: z.enum(["digital", "physical", "service"]),
  privacy: privacyDisclosureSchema,
  memo: z.string(),
  payTo: z.string()
});

export const orderResponseSchema = z.object({
  orderId: z.string(),
  quoteId: z.string(),
  status: z.enum(["awaiting_payment", "paid", "fulfilled", "expired"]),
  amountZec: z.string(),
  payTo: z.string(),
  memo: z.string(),
  expiresAt: z.string()
});

export const directTransferRequestSchema = z.object({
  recipientName: z.string().min(1),
  amountZec: z.string().min(1),
  address: z.string().min(1),
  memo: z.string().max(512).default(""),
  purpose: z.string().default(""),
  evidenceUrls: z.array(z.string().url()).default([]),
  agentVerificationNotes: z.string().default("")
});
