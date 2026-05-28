"use client";

import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  Coins,
  FileCheck,
  Gauge,
  KeyRound,
  Package,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Terminal,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Purchase, ShippingProfile, WalletState, ZecGuardConfig, ZecGuardState } from "@zecguard/core";

interface DashboardPayload {
  config: ZecGuardConfig;
  configText: string;
  state: ZecGuardState;
}

function zec(zats: number): string {
  return `${(zats / 100_000_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} ZEC`;
}

function statusLabel(status: Purchase["status"]): string {
  return status.replace(/_/g, " ");
}

function statusTone(status: Purchase["status"]): string {
  if (status === "receipted" || status === "fulfilled") return "good";
  if (status === "policy_blocked" || status === "verification_failed" || status === "payment_failed") return "bad";
  if (status === "awaiting_approval" || status === "payment_submitted" || status === "pending_confirmation") return "warn";
  return "neutral";
}

export function DashboardClient() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [requestText, setRequestText] = useState(
    "Buy a private AI briefing about how ZEC-native vendors can accept agent purchases."
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    setPayload(await response.json());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const pendingPurchases = useMemo(
    () =>
      payload?.state.purchases.filter((purchase) =>
        ["awaiting_approval", "policy_blocked", "policy_checked"].includes(purchase.status)
      ) ?? [],
    [payload]
  );
  const receipts = payload?.state.purchases.filter((purchase) => purchase.receipt) ?? [];

  async function callAction(label: string, action: () => Promise<Response>) {
    setBusy(label);
    setError(null);
    try {
      const response = await action();
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error ?? "Action failed");
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  function requestPurchase() {
    return callAction("request", () =>
      fetch("/api/demo/request-purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestText })
      })
    );
  }

  function approve(purchase: Purchase) {
    return callAction(`approve-${purchase.id}`, () =>
      fetch(`/api/purchases/${purchase.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: payload?.config.shippingProfiles[0]?.id,
          overrideReason: purchase.policy.severity === "blocked" ? "One-time user override from dashboard." : undefined
        })
      })
    );
  }

  function reject(purchase: Purchase) {
    return callAction(`reject-${purchase.id}`, () =>
      fetch(`/api/purchases/${purchase.id}/reject`, {
        method: "POST"
      })
    );
  }

  function topUp() {
    return callAction("fund", () =>
      fetch("/api/wallet/fund", {
        method: "POST"
      })
    );
  }

  if (!payload) {
    return (
      <main className="shell">
        <div className="loading-panel">
          <RefreshCw className="spin" size={18} />
          Loading ZecGuard
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ZecGuard</div>
          <h1>Agent spending firewall</h1>
        </div>
        <div className="top-actions">
          <StatusPill icon={<ShieldCheck size={14} />} label="Human approval" tone="good" />
          <StatusPill icon={<KeyRound size={14} />} label={payload.state.wallet.mode} tone="neutral" />
          <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh dashboard">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}

      <section className="metrics-grid">
        <WalletMetric wallet={payload.state.wallet} onTopUp={() => void topUp()} busy={busy === "fund"} />
        <MetricCard icon={<Gauge size={18} />} label="Today spent" value={zec(payload.state.wallet.spentTodayZats)} />
        <MetricCard icon={<Clock size={18} />} label="Month spent" value={zec(payload.state.wallet.spentMonthZats)} />
        <MetricCard
          icon={<FileCheck size={18} />}
          label="Receipts"
          value={String(receipts.length)}
          detail="signed private receipts"
        />
      </section>

      <section className="workspace-grid">
        <section className="panel purchase-panel">
          <div className="panel-heading">
            <div>
              <h2>Agent request</h2>
              <p>Natural-language intent converted into a ZEC Harness purchase.</p>
            </div>
            <button className="primary-button" onClick={() => void requestPurchase()} disabled={busy !== null}>
              <ShoppingCart size={16} />
              Request quote
            </button>
          </div>
          <textarea
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            spellCheck={false}
            aria-label="Agent purchase request"
          />
          <div className="quick-actions">
            <button
              className="secondary-button"
              onClick={() =>
                setRequestText("Buy a private AI briefing about Zcash agent payment safety and receipt design.")
              }
            >
              <Terminal size={15} />
              AI service
            </button>
            <button
              className="secondary-button"
              onClick={() => setRequestText("Buy and ship the privacy hardware starter kit using my home profile.")}
            >
              <Package size={15} />
              Physical item
            </button>
          </div>
        </section>

        <section className="panel approvals-panel">
          <div className="panel-heading">
            <div>
              <h2>Approvals</h2>
              <p>{pendingPurchases.length ? `${pendingPurchases.length} purchase waiting` : "No pending spend"}</p>
            </div>
          </div>
          <div className="approval-list">
            {pendingPurchases.length ? (
              pendingPurchases.map((purchase) => (
                <PurchaseApproval
                  key={purchase.id}
                  purchase={purchase}
                  profile={payload.config.shippingProfiles[0]}
                  busy={busy}
                  onApprove={() => void approve(purchase)}
                  onReject={() => void reject(purchase)}
                />
              ))
            ) : (
              <div className="empty-state">
                <ShieldCheck size={18} />
                The agent has no payment authority queued.
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="lower-grid">
        <ActivityPanel events={payload.state.activity} />
        <ReceiptsPanel purchases={receipts} />
        <PolicyPanel configText={payload.configText} config={payload.config} />
      </section>
    </main>
  );
}

function WalletMetric({
  wallet,
  busy,
  onTopUp
}: {
  wallet: WalletState;
  busy: boolean;
  onTopUp: () => void;
}) {
  const isReal = wallet.mode === "external-cli";
  return (
    <article className="metric-card">
      <div className="metric-icon">
        <Coins size={18} />
      </div>
      <div>
        <span>Agent balance{wallet.balanceSource === "live" ? " (live)" : wallet.balanceSource === "cached" ? " (cached)" : ""}</span>
        <strong>{zec(wallet.balanceZats)}</strong>
        <small>{wallet.address.slice(0, 18)}...</small>
      </div>
      <button className="mini-button" onClick={onTopUp} disabled={busy} title={isReal ? "Refresh balance" : "Add 0.10 ZEC"}>
        {isReal ? <RefreshCw size={14} /> : <Coins size={14} />}
      </button>
    </article>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function StatusPill({
  icon,
  label,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  tone: "good" | "neutral" | "warn";
}) {
  return (
    <span className={`status-pill ${tone}`}>
      {icon}
      {label}
    </span>
  );
}

function PurchaseApproval({
  purchase,
  profile,
  busy,
  onApprove,
  onReject
}: {
  purchase: Purchase;
  profile?: ShippingProfile;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="approval-card">
      <div className="approval-top">
        <div>
          <div className="approval-title">{purchase.itemTitle}</div>
          <div className="approval-meta">
            {purchase.vendorName} · {purchase.amountZec} ZEC · {statusLabel(purchase.status)}
          </div>
        </div>
        <span className={`privacy-badge ${purchase.privacy.grade}`}>{purchase.privacy.label}</span>
      </div>

      <div className="approval-body">
        <div>
          <h3>Conditions</h3>
          <ul>
            {purchase.terms.slice(0, 3).map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Policy</h3>
          <div className="checks">
            {purchase.policy.checks.map((check) => (
              <span className={`check ${check.severity}`} key={check.id}>
                {check.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {purchase.requiredPii.length ? (
        <div className="pii-box">
          <strong>Shares:</strong> {purchase.requiredPii.join(", ")}
          {profile ? <span> from {profile.label}</span> : null}
        </div>
      ) : null}

      <div className="approval-actions">
        <button className="danger-button" onClick={onReject} disabled={busy !== null}>
          <X size={15} />
          Reject
        </button>
        <button className="primary-button" onClick={onApprove} disabled={busy !== null}>
          <Check size={15} />
          Approve
        </button>
      </div>
    </article>
  );
}

function ActivityPanel({ events }: { events: ActivityEvent[] }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>Activity</h2>
        <Activity size={17} />
      </div>
      <div className="event-list">
        {events.slice(0, 9).map((event) => (
          <div className="event-row" key={event.id}>
            <span className="event-dot" />
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
              <small>{new Date(event.timestamp).toLocaleTimeString()}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReceiptsPanel({ purchases }: { purchases: Purchase[] }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>Receipts</h2>
        <FileCheck size={17} />
      </div>
      <div className="receipt-list">
        {purchases.length ? (
          purchases.slice(0, 5).map((purchase) => (
            <div className="receipt-row" key={purchase.id}>
              <div>
                <strong>{purchase.itemTitle}</strong>
                <p>{purchase.receipt?.summary}</p>
              </div>
              <span className={`status-tag ${statusTone(purchase.status)}`}>{purchase.amountZec} ZEC</span>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <FileCheck size={18} />
            No receipts yet.
          </div>
        )}
      </div>
    </section>
  );
}

function PolicyPanel({ configText, config }: { configText: string; config: ZecGuardConfig }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>Policy</h2>
        <span className="status-tag neutral">{config.spending.perTransactionZec} ZEC max</span>
      </div>
      <pre className="config-preview">{configText}</pre>
    </section>
  );
}
