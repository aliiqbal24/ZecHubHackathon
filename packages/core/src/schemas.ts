import { z } from "zod";
import { zecToZats } from "./money.js";
import type { ZecGuardConfig } from "./types.js";

const zecAmountStringSchema = z.string().refine(
  (value) => {
    try {
      zecToZats(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid non-negative ZEC amount with up to 8 decimal places." }
);

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().optional()
);

const httpUrlStringSchema = z.string().url().refine(
  (value) => {
    return value.startsWith("http://") || value.startsWith("https://");
  },
  { message: "Must be an HTTP or HTTPS URL." }
);

const optionalHttpUrlStringSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  httpUrlStringSchema.optional()
);

const agentConfigSchema = z.object({
  name: z.string().min(1),
  walletMode: z.enum(["mock", "external-cli"]),
  walletAddress: z.string().min(1),
  externalCliCommand: optionalNonEmptyString,
  externalCliBalanceCommand: optionalNonEmptyString,
  externalCliTxCheckCommand: optionalNonEmptyString,
  walletPreset: z.enum(["zodl", "zingo-cli", "zallet"]).optional()
});

const agentWalletConfigSchema = z
  .object({
    backend: z.enum(["mock", "zingo-cli"]).optional(),
    label: optionalNonEmptyString,
    walletId: optionalNonEmptyString,
    zingoCliPath: optionalNonEmptyString,
    zingoServerUrl: optionalHttpUrlStringSchema,
    mainReturnAddress: optionalNonEmptyString
  })
  .optional();

const shippingProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  name: z.string().min(1),
  line1: z.string().min(1),
  line2: optionalNonEmptyString,
  city: z.string().min(1),
  region: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  email: optionalNonEmptyString,
  phone: optionalNonEmptyString
});

export const zecGuardConfigSchema = z
  .object({
    agent: agentConfigSchema,
    agentWallet: agentWalletConfigSchema,
    spending: z.object({
      perTransactionZec: zecAmountStringSchema,
      dailyZec: zecAmountStringSchema,
      monthlyZec: zecAmountStringSchema
    }),
    approval: z.object({
      requireEveryPayment: z.boolean(),
      allowOneTimeOverride: z.boolean()
    }),
    vendors: z.object({
      allowUnknownVendors: z.boolean(),
      trusted: z.array(httpUrlStringSchema).default([])
    }),
    privacy: z.object({
      showPrivacyLabel: z.boolean()
    }),
    shippingProfiles: z.array(shippingProfileSchema).default([]),
    verification: z
      .object({
        mode: z.enum(["mock", "external-cli", "lightwalletd"]).default("mock"),
        lightwalletdUrl: optionalHttpUrlStringSchema,
        viewingKey: optionalNonEmptyString,
        externalCliCommand: optionalNonEmptyString,
        minConfirmations: z.number().int().positive().default(1)
      })
      .default({ mode: "mock", minConfirmations: 1 })
  })
  .transform((config): ZecGuardConfig => {
    const agentWallet = config.agentWallet ?? {};
    const backend = agentWallet.backend ?? (config.agent.walletMode === "mock" ? "mock" : "zingo-cli");
    return {
      ...config,
      agentWallet: {
        ...agentWallet,
        backend,
        label: agentWallet.label ?? `${config.agent.name} Wallet`,
        walletId: agentWallet.walletId ?? "agent-default",
        zingoCliPath: agentWallet.zingoCliPath ?? "zingo-cli"
      },
      vendors: {
        ...config.vendors,
        trusted: config.vendors.trusted ?? []
      },
      shippingProfiles: config.shippingProfiles ?? [],
      verification: {
        mode: config.verification.mode,
        minConfirmations: config.verification.minConfirmations,
        lightwalletdUrl: config.verification.lightwalletdUrl,
        viewingKey: config.verification.viewingKey,
        externalCliCommand: config.verification.externalCliCommand
      }
    };
  });

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
