export type PurchaseStatus =
  | "draft"
  | "quoted"
  | "policy_checked"
  | "awaiting_approval"
  | "approved"
  | "payment_submitted"
  | "pending_confirmation"
  | "vendor_verified"
  | "fulfilled"
  | "receipted"
  | "rejected"
  | "expired"
  | "policy_blocked"
  | "payment_failed"
  | "verification_failed";

export type TransactionStatus = "pending" | "confirmed" | "not_found";

export interface TransactionInfo {
  txId: string;
  status: TransactionStatus;
  confirmations: number;
  blockHeight?: number;
}

export type WalletPresetName = "zingo-cli" | "zcash-cli" | "zallet";

export interface WalletPreset {
  name: WalletPresetName;
  label: string;
  sendCommandTemplate: string;
  balanceCommand: string;
  transactionCheckCommandTemplate: string;
}

export type VerificationMode = "mock" | "external-cli" | "lightwalletd";

export interface VerificationConfig {
  mode: VerificationMode;
  lightwalletdUrl?: string;
  viewingKey?: string;
  externalCliCommand?: string;
  minConfirmations: number;
}

export interface VerifiedPayment {
  txId: string;
  amountZec: string;
  memo: string;
  confirmations: number;
  blockHeight?: number;
  matchedAt: string;
}

export type FulfillmentType = "digital" | "physical" | "service";

export type PolicySeverity = "pass" | "warn" | "blocked";

export interface AgentConfig {
  name: string;
  walletMode: "mock" | "external-cli";
  walletAddress: string;
  externalCliCommand?: string;
  externalCliBalanceCommand?: string;
  externalCliTxCheckCommand?: string;
  walletPreset?: WalletPresetName;
}

export interface SpendingConfig {
  perTransactionZec: string;
  dailyZec: string;
  monthlyZec: string;
}

export interface ApprovalConfig {
  requireEveryPayment: boolean;
  allowOneTimeOverride: boolean;
}

export interface VendorConfig {
  allowUnknownVendors: boolean;
  trusted: string[];
}

export interface PrivacyConfig {
  showPrivacyLabel: boolean;
}

export interface ShippingProfile {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  email?: string;
  phone?: string;
}

export interface ZecGuardConfig {
  agent: AgentConfig;
  spending: SpendingConfig;
  approval: ApprovalConfig;
  vendors: VendorConfig;
  privacy: PrivacyConfig;
  shippingProfiles: ShippingProfile[];
  verification?: VerificationConfig;
}

export interface PrivacyDisclosure {
  label: string;
  grade: "strong" | "medium" | "weak";
  leaks: string[];
  summary: string;
}

export interface HarnessManifest {
  name: string;
  vendorUrl: string;
  version: string;
  description: string;
  zecHarness: {
    quoteUrl: string;
    orderUrl: string;
    verifyUrlTemplate?: string;
    receiptPublicKey: string;
    supportedFulfillment: FulfillmentType[];
  };
  privacy: PrivacyDisclosure;
  products: VendorProduct[];
}

export interface VendorProduct {
  id: string;
  title: string;
  description: string;
  fulfillmentType: FulfillmentType;
  basePriceZec: string;
  requiresPii: string[];
}

export interface QuoteRequest {
  itemId: string;
  quantity?: number;
  options?: Record<string, unknown>;
  shippingProfile?: Partial<ShippingProfile>;
}

export interface QuoteResponse {
  quoteId: string;
  vendorUrl: string;
  vendorName: string;
  itemId: string;
  itemTitle: string;
  amountZec: string;
  expiresAt: string;
  terms: string[];
  requiredPii: string[];
  fulfillmentType: FulfillmentType;
  privacy: PrivacyDisclosure;
  memo: string;
  payTo: string;
}

export interface OrderResponse {
  orderId: string;
  quoteId: string;
  status: "awaiting_payment" | "paid" | "fulfilled" | "expired";
  amountZec: string;
  payTo: string;
  memo: string;
  expiresAt: string;
}

export interface PaymentRecord {
  txId: string;
  amountZec: string;
  amountZats: number;
  payTo: string;
  memo: string;
  submittedAt: string;
  walletMode: "mock" | "external-cli";
}

export interface PaymentLedgerEntry extends PaymentRecord {
  purchaseId: string;
  orderId: string;
  vendorUrl: string;
  recordedAt: string;
}

export interface PrivateReceipt {
  receiptId: string;
  orderId: string;
  quoteId: string;
  vendorUrl: string;
  amountZec: string;
  txId: string;
  fulfilledAt: string;
  summary: string;
  signature: string;
}

export interface Fulfillment {
  type: FulfillmentType;
  summary: string;
  payload: Record<string, unknown>;
}

export interface PolicyCheck {
  id: string;
  label: string;
  severity: PolicySeverity;
  detail: string;
}

export interface PolicyResult {
  severity: PolicySeverity;
  requiresApproval: boolean;
  checks: PolicyCheck[];
}

export interface Purchase {
  id: string;
  status: PurchaseStatus;
  createdAt: string;
  updatedAt: string;
  vendorUrl: string;
  vendorName: string;
  itemId: string;
  itemTitle: string;
  amountZec: string;
  amountZats: number;
  fulfillmentType: FulfillmentType;
  terms: string[];
  requiredPii: string[];
  releasedPii?: Record<string, unknown>;
  privacy: PrivacyDisclosure;
  policy: PolicyResult;
  quoteId: string;
  orderId: string;
  payTo: string;
  memo: string;
  expiresAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  approvalReason?: string;
  payment?: PaymentRecord;
  fulfillment?: Fulfillment;
  receipt?: PrivateReceipt;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  kind:
    | "quote"
    | "policy"
    | "approval"
    | "payment"
    | "vendor"
    | "fulfillment"
    | "receipt"
    | "system";
  title: string;
  detail: string;
  purchaseId?: string;
}

export interface WalletState {
  mode: "mock" | "external-cli";
  address: string;
  balanceZats: number;
  spentTodayZats: number;
  spentMonthZats: number;
  balanceSource?: "mock" | "cached" | "live";
  balanceUpdatedAt?: string;
}

export interface VendorOrder {
  orderId: string;
  quote: QuoteResponse;
  status: "awaiting_payment" | "paid" | "fulfilled" | "expired";
  createdAt: string;
  paidAt?: string;
  fulfilledAt?: string;
  payment?: PaymentRecord;
  fulfillment?: Fulfillment;
  receipt?: PrivateReceipt;
  releasedPii?: Record<string, unknown>;
}

export interface ZecGuardState {
  wallet: WalletState;
  purchases: Purchase[];
  activity: ActivityEvent[];
  vendorOrders: VendorOrder[];
  paymentLedger: PaymentLedgerEntry[];
}
