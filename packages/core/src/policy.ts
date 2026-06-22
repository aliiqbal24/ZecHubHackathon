import { zecToZats } from "./money.js";
import type {
  DirectTransferRequest,
  PolicyCheck,
  PolicyResult,
  Purchase,
  QuoteResponse,
  AgentZcashConfig,
  AgentZcashState
} from "./types.js";
import { looksLikeShieldedZcashAddress } from "./wallet.js";

function mostSevere(checks: PolicyCheck[]): PolicyResult["severity"] {
  if (checks.some((check) => check.severity === "blocked")) return "blocked";
  if (checks.some((check) => check.severity === "warn")) return "warn";
  return "pass";
}

export function evaluateQuotePolicy(
  quote: QuoteResponse,
  config: AgentZcashConfig,
  state: AgentZcashState
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

export function evaluateDirectTransferPolicy(
  request: DirectTransferRequest,
  config: AgentZcashConfig,
  state: AgentZcashState
): PolicyResult {
  const amountZats = zecToZats(request.amountZec);
  const perTxLimit = zecToZats(config.spending.perTransactionZec);
  const dailyLimit = zecToZats(config.spending.dailyZec);
  const monthlyLimit = zecToZats(config.spending.monthlyZec);
  const memoBytes = Buffer.byteLength(request.memo, "utf8");

  const checks: PolicyCheck[] = [
    amountZats > 0
      ? {
          id: "amount-positive",
          label: "Amount",
          severity: "pass",
          detail: "Transfer amount is positive."
        }
      : {
          id: "amount-positive",
          label: "Amount",
          severity: "blocked",
          detail: "Transfer amount must be greater than zero."
        },
    amountZats <= perTxLimit
      ? {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "pass",
          detail: `${request.amountZec} ZEC is within the ${config.spending.perTransactionZec} ZEC limit.`
        }
      : {
          id: "per-transaction",
          label: "Per-transaction limit",
          severity: "blocked",
          detail: `${request.amountZec} ZEC exceeds the ${config.spending.perTransactionZec} ZEC limit.`
        },
    state.wallet.spentTodayZats + amountZats <= dailyLimit
      ? {
          id: "daily",
          label: "Daily budget",
          severity: "pass",
          detail: "This transfer fits today's budget."
        }
      : {
          id: "daily",
          label: "Daily budget",
          severity: "blocked",
          detail: "This transfer would exceed today's agent budget."
        },
    state.wallet.spentMonthZats + amountZats <= monthlyLimit
      ? {
          id: "monthly",
          label: "Monthly budget",
          severity: "pass",
          detail: "This transfer fits the monthly budget."
        }
      : {
          id: "monthly",
          label: "Monthly budget",
          severity: "blocked",
          detail: "This transfer would exceed the monthly agent budget."
        },
    looksLikeShieldedZcashAddress(request.address)
      ? {
          id: "address",
          label: "Recipient address",
          severity: "pass",
          detail: "Recipient supplied a shielded-capable Zcash address."
        }
      : {
          id: "address",
          label: "Recipient address",
          severity: "blocked",
          detail: "Recipient address must be a shielded-capable Zcash address."
        },
    memoBytes <= 512
      ? {
          id: "memo",
          label: "Memo safety",
          severity: "pass",
          detail: "Memo fits shielded memo size."
        }
      : {
          id: "memo",
          label: "Memo safety",
          severity: "blocked",
          detail: "Memo must fit the 512 byte shielded memo limit."
        },
    request.purpose.trim().length > 0
      ? {
          id: "purpose",
          label: "Purpose",
          severity: "pass",
          detail: "Transfer includes a purpose for user review."
        }
      : {
          id: "purpose",
          label: "Purpose",
          severity: "warn",
          detail: "No purpose was provided."
        },
    request.evidenceUrls.length > 0 || request.agentVerificationNotes.trim().length > 0
      ? {
          id: "evidence",
          label: "Evidence",
          severity: "pass",
          detail: "Agent supplied evidence or verification notes."
        }
      : {
          id: "evidence",
          label: "Evidence",
          severity: "warn",
          detail: "No source evidence or verification notes were provided."
        },
    {
      id: "approval",
      label: "Human approval",
      severity: "pass",
      detail: "Final user confirmation is required before payment."
    }
  ];

  return {
    severity: mostSevere(checks),
    requiresApproval: true,
    checks
  };
}

export function canApprovePurchase(purchase: Purchase): boolean {
  return purchase.status === "awaiting_approval" || purchase.status === "policy_checked";
}
