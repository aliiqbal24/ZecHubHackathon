import { zecToZats } from "./money.js";
import type { PolicyCheck, PolicyResult, Purchase, QuoteResponse, ZecGuardConfig, ZecGuardState } from "./types.js";

function mostSevere(checks: PolicyCheck[]): PolicyResult["severity"] {
  if (checks.some((check) => check.severity === "blocked")) return "blocked";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  return "pass";
}

export function evaluateQuotePolicy(
  quote: QuoteResponse,
  config: ZecGuardConfig,
  state: ZecGuardState
): PolicyResult {
  const amountZats = zecToZats(quote.amountZec);
  const perTxLimit = zecToZats(config.spending.perTransactionZec);
  const dailyLimit = zecToZats(config.spending.dailyZec);
  const monthlyLimit = zecToZats(config.spending.monthlyZec);
  const trusted = config.vendors.trusted.includes(quote.vendorUrl);
  const expiresAt = new Date(quote.expiresAt).getTime();
  const memoBytes = Buffer.byteLength(quote.memo, "utf8");

  const checks: PolicyCheck[] = [
    amountZats > 0
      ? {
          id: "amount-positive",
          label: "Amount",
          severity: "pass",
          detail: "Quote amount is positive."
        }
      : {
          id: "amount-positive",
          label: "Amount",
          severity: "blocked",
          detail: "Quote amount must be greater than zero."
        },
    amountZats <= perTxLimit
      ? {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "pass",
          detail: `${quote.amountZec} ZEC is within the ${config.spending.perTransactionZec} ZEC limit.`
        }
      : {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "blocked",
          detail: `${quote.amountZec} ZEC exceeds the ${config.spending.perTransactionZec} ZEC limit.`
        },
    state.wallet.spentTodayZats + amountZats <= dailyLimit
      ? {
          id: "daily",
          label: "Daily budget",
          severity: "pass",
          detail: "This purchase fits today's budget."
        }
      : {
          id: "daily",
          label: "Daily budget",
          severity: "blocked",
          detail: "This purchase would exceed today's agent budget."
        },
    state.wallet.spentMonthZats + amountZats <= monthlyLimit
      ? {
          id: "monthly",
          label: "Monthly budget",
          severity: "pass",
          detail: "This purchase fits the monthly budget."
        }
      : {
          id: "monthly",
          label: "Monthly budget",
          severity: "blocked",
          detail: "This purchase would exceed the monthly agent budget."
        },
    trusted
      ? {
          id: "vendor",
          label: "Vendor trust",
          severity: "pass",
          detail: "Vendor is in the local trusted list."
        }
      : {
          id: "vendor",
          label: "Vendor trust",
          severity: config.vendors.allowUnknownVendors ? "warn" : "blocked",
          detail: config.vendors.allowUnknownVendors
            ? "Unknown vendor is allowed by policy and will be highlighted for approval."
            : "Unknown vendor is blocked by policy."
        },
    Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? {
          id: "expiry",
          label: "Quote expiry",
          severity: "pass",
          detail: "Quote has not expired."
        }
      : {
          id: "expiry",
          label: "Quote expiry",
          severity: "blocked",
          detail: "Quote is expired or has an invalid expiry."
        },
    memoBytes <= 512 && quote.memo.includes(quote.quoteId)
      ? {
          id: "memo",
          label: "Memo safety",
          severity: "pass",
          detail: "Memo fits shielded memo size and includes quote correlation."
        }
      : {
          id: "memo",
          label: "Memo safety",
          severity: "blocked",
          detail: "Memo must fit 512 bytes and bind to the quote id."
        },
    quote.payTo.length >= 20
      ? {
          id: "address",
          label: "Payment address",
          severity: "pass",
          detail: "Vendor supplied a payment address."
        }
      : {
          id: "address",
          label: "Payment address",
          severity: "blocked",
          detail: "Vendor payment address is missing or malformed."
        },
    quote.requiredPii.length === 0
      ? {
          id: "pii",
          label: "PII release",
          severity: "pass",
          detail: "No identity or shipping fields are required."
        }
      : {
          id: "pii",
          label: "PII release",
          severity: "warn",
          detail: `Vendor requests: ${quote.requiredPii.join(", ")}.`
        },
    {
      id: "approval",
      label: "Human approval",
      severity: "pass",
      detail: config.approval.requireEveryPayment
        ? "Final user confirmation is required before payment."
        : "Autonomous payment is allowed by policy."
    }
  ];

  return {
    severity: mostSevere(checks),
    requiresApproval: config.approval.requireEveryPayment || checks.some((check) => check.severity !== "pass"),
    checks
  };
}

export interface GenericPaymentPolicyInput {
  amountZec: string;
  payTo: string;
  memo: string;
  expiresAt: string;
  recipientLabel?: string;
  recipientTrusted?: boolean;
  fulfillmentKnown?: boolean;
  invoiceStable?: boolean;
  warningIds?: string[];
}

export function evaluateGenericPaymentPolicy(
  payment: GenericPaymentPolicyInput,
  config: ZecGuardConfig,
  state: ZecGuardState
): PolicyResult {
  const amountZats = zecToZats(payment.amountZec);
  const perTxLimit = zecToZats(config.spending.perTransactionZec);
  const dailyLimit = zecToZats(config.spending.dailyZec);
  const monthlyLimit = zecToZats(config.spending.monthlyZec);
  const expiresAt = new Date(payment.expiresAt).getTime();
  const memoBytes = Buffer.byteLength(payment.memo, "utf8");
  const memoLooksSensitive =
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(payment.memo) ||
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(payment.memo);
  const recipientTrusted = payment.recipientTrusted === true;
  const fulfillmentKnown = payment.fulfillmentKnown === true;
  const invoiceStable = payment.invoiceStable !== false;

  const baseChecks: PolicyCheck[] = [
    amountZats > 0
      ? {
          id: "amount-positive",
          label: "Amount",
          severity: "pass",
          detail: "Payment amount is positive."
        }
      : {
          id: "amount-positive",
          label: "Amount",
          severity: "blocked",
          detail: "Payment amount must be greater than zero."
        },
    amountZats <= perTxLimit
      ? {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "pass",
          detail: `${payment.amountZec} ZEC is within the ${config.spending.perTransactionZec} ZEC limit.`
        }
      : {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "blocked",
          detail: `${payment.amountZec} ZEC exceeds the ${config.spending.perTransactionZec} ZEC limit.`
        },
    state.wallet.spentTodayZats + amountZats <= dailyLimit
      ? {
          id: "daily",
          label: "Daily budget",
          severity: "pass",
          detail: "This payment fits today's budget."
        }
      : {
          id: "daily",
          label: "Daily budget",
          severity: "blocked",
          detail: "This payment would exceed today's agent budget."
        },
    state.wallet.spentMonthZats + amountZats <= monthlyLimit
      ? {
          id: "monthly",
          label: "Monthly budget",
          severity: "pass",
          detail: "This payment fits the monthly budget."
        }
      : {
          id: "monthly",
          label: "Monthly budget",
          severity: "blocked",
          detail: "This payment would exceed the monthly agent budget."
        },
    Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? {
          id: "expiry",
          label: "Payment expiry",
          severity: "pass",
          detail: "Payment approval request has not expired."
        }
      : {
          id: "expiry",
          label: "Payment expiry",
          severity: "blocked",
          detail: "Payment approval request is expired or has an invalid expiry."
        },
    memoBytes <= 512
      ? {
          id: "memo-size",
          label: "Memo size",
          severity: "pass",
          detail: "Memo fits shielded memo size."
        }
      : {
          id: "memo-size",
          label: "Memo size",
          severity: "blocked",
          detail: "Memo must fit 512 bytes."
        },
    memoLooksSensitive
      ? {
          id: "memo-pii",
          label: "Memo privacy",
          severity: "warn",
          detail: "Memo appears to contain contact information. Review before approval."
        }
      : {
          id: "memo-pii",
          label: "Memo privacy",
          severity: "pass",
          detail: "Memo does not look like it contains common contact PII."
        },
    payment.payTo.length >= 20
      ? {
          id: "address",
          label: "Payment address",
          severity: "pass",
          detail: "Recipient supplied a payment address."
        }
      : {
          id: "address",
          label: "Payment address",
          severity: "blocked",
          detail: "Recipient payment address is missing or malformed."
        },
    invoiceStable
      ? {
          id: "invoice-stability",
          label: "Invoice stability",
          severity: "pass",
          detail: "Invoice amount and address were stable during extraction."
        }
      : {
          id: "invoice-stability",
          label: "Invoice stability",
          severity: "blocked",
          detail: "Invoice amount or address changed during extraction."
        },
    {
      id: "recipient",
      label: "Recipient trust",
      severity: recipientTrusted ? "pass" : "warn",
      detail: recipientTrusted
        ? payment.recipientLabel
          ? `"${payment.recipientLabel}" is trusted by local policy.`
          : "Recipient is trusted by local policy."
        : payment.recipientLabel
          ? `Generic ZEC recipient "${payment.recipientLabel}" is not trusted by local policy.`
          : "Generic ZEC recipient is not trusted by local policy."
    },
    {
      id: "fulfillment",
      label: "Fulfillment",
      severity: fulfillmentKnown ? "pass" : "warn",
      detail: fulfillmentKnown
        ? "Fulfillment or contact context is known for this payment."
        : "Generic ZEC payments only produce a local receipt unless the recipient exposes a verification API."
    },
    {
      id: "approval",
      label: "Human approval",
      severity: "pass",
      detail: config.approval.requireEveryPayment
        ? "Final user confirmation is required before payment."
        : "Autonomous payment is allowed by policy."
    }
  ];
  const checks: PolicyCheck[] = baseChecks.map((check) =>
    payment.warningIds?.includes(check.id) && check.severity === "pass"
      ? { ...check, severity: "warn" as const, detail: `${check.detail} Review required by checkout warning.` }
      : check
  );

  return {
    severity: mostSevere(checks),
    requiresApproval: config.approval.requireEveryPayment || checks.some((check) => check.severity !== "pass"),
    checks
  };
}

export function canApprovePurchase(purchase: Purchase): boolean {
  return purchase.status === "awaiting_approval" || purchase.status === "policy_checked";
}

export function canAutopayByPolicy(policy: PolicyResult, config: ZecGuardConfig): boolean {
  return !config.approval.requireEveryPayment && policy.severity === "pass" && !policy.requiresApproval;
}
