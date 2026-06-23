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
  RefreshCw,
  Save,
  ShieldCheck,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityEvent, Purchase, ShippingProfile, WalletState, AgentZcashConfig, AgentZcashState } from "@agentzcash/core";

interface DashboardPayload {
  config: AgentZcashConfig;
  configText: string;
  state: AgentZcashState;
}

interface DashboardErrorPayload {
  error?: unknown;
  setupCommand?: unknown;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalContext, setApprovalContext] = useState<{ purchaseId?: string; approvalToken?: string }>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settings, setSettings] = useState({
    requireEveryPayment: true,
    perTransactionZec: "",
    dailyZec: "",
    monthlyZec: ""
  });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as DashboardPayload | DashboardErrorPayload;
      if (!response.ok) {
        const message =
          "error" in json && typeof json.error === "string"
            ? json.error
            : `Dashboard request failed (${response.status}).`;
        throw new Error(message);
      }
      setPayload(json as DashboardPayload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dashboard request failed.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setApprovalContext({
      purchaseId: params.get("purchase") ?? undefined,
      approvalToken: params.get("approvalToken") ?? undefined
    });
  }, []);

  useEffect(() => {
    if (!payload || settingsDirty) return;
    setSettings({
      requireEveryPayment: payload.config.approval.requireEveryPayment,
      perTransactionZec: payload.config.spending.perTransactionZec,
      dailyZec: payload.config.spending.dailyZec,
      monthlyZec: payload.config.spending.monthlyZec
    });
  }, [payload, settingsDirty]);

  const pendingPurchases = useMemo(
    () =>
      payload?.state.purchases.filter((purchase) =>
        ["awaiting_approval", "policy_blocked", "policy_checked"].includes(purchase.status)
      ) ?? [],
    [payload]
  );
  const receipts = payload?.state.purchases.filter((purchase) => purchase.receipt || purchase.paymentReceipt) ?? [];

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

  function approve(purchase: Purchase) {
    const approvalToken =
      approvalContext.purchaseId === purchase.id ? approvalContext.approvalToken : undefined;
    if (!approvalToken) {
      setError("Open the AgentZcash approval URL before approving this payment.");
      return;
    }

    return callAction(`approve-${purchase.id}`, () =>
      fetch(`/api/purchases/${purchase.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: payload?.config.shippingProfiles[0]?.id,
          approvalToken,
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

  async function saveSettings() {
    setBusy("settings");
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.error ?? "Settings update failed");
      }
      setSettingsDirty(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings update failed");
    } finally {
      setBusy(null);
    }
  }

  if (!payload) {
    return (
      <main className="shell">
        {error ? (
          <div className="setup-panel">
            <AlertTriangle size={18} />
            <div>
              <h1>AgentZcash setup required</h1>
              <p>{error}</p>
              <code>npx agentzcash init</code>
            </div>
          </div>
        ) : (
          <div className="loading-panel">
            <RefreshCw className="spin" size={18} />
            Loading AgentZcash
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">AgentZcash</div>
          <h1>Agent spending firewall</h1>
        </div>
        <div className="top-actions">
          <StatusPill
            icon={<ShieldCheck size={14} />}
            label={payload.config.approval.requireEveryPayment ? "Approval required" : "Autonomous below limits"}
            tone={payload.config.approval.requireEveryPayment ? "good" : "warn"}
          />
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
          detail="stored payment receipts"
        />
      </section>

      <section className="workspace-grid">
        <section className="panel approvals-panel">
          <div className="panel-heading">
            <div>
              <h2>Approvals</h2>
              <p>{pendingPurchases.length ? `${pendingPurchases.length} spend waiting` : "No pending spend"}</p>
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
                  canApprove={
                    approvalContext.purchaseId === purchase.id &&
                    Boolean(approvalContext.approvalToken) &&
                    !(purchase.kind === "direct_transfer" && purchase.policy.severity === "blocked")
                  }
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
        <PolicyPanel
          configText={payload.configText}
          config={payload.config}
          settings={settings}
          busy={busy === "settings"}
          onSettingsChange={setSettings}
          onSettingsDirty={() => setSettingsDirty(true)}
          onSaveSettings={() => void saveSettings()}
        />
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
  return (
    <article className="metric-card">
      <div className="metric-icon">
        <Coins size={18} />
      </div>
      <div>
        <span>Agent balance{wallet.balanceSource === "live" ? " (live)" : " (unavailable)"}</span>
        <strong>{zec(wallet.balanceZats)}</strong>
        <small>{wallet.address.slice(0, 18)}...</small>
      </div>
      <button className="mini-button" onClick={onTopUp} disabled={busy} title="Refresh balance">
        <RefreshCw size={14} />
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
  canApprove,
  onApprove,
  onReject
}: {
  purchase: Purchase;
  profile?: ShippingProfile;
  busy: string | null;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="approval-card">
      <div className="approval-top">
        <div>
          <div className="approval-title">{purchase.itemTitle}</div>
          <div className="approval-meta">
            {purchase.vendorName} - {purchase.amountZec} ZEC - {statusLabel(purchase.status)}
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

      {purchase.kind === "direct_transfer" ? (
        <div className="pii-box">
          <strong>Address:</strong> {purchase.payTo}
          {purchase.memo ? <span> Memo: {purchase.memo}</span> : null}
        </div>
      ) : null}

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
        <button className="primary-button" onClick={onApprove} disabled={busy !== null || !canApprove}>
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
                <p>{purchase.receipt?.summary ?? purchase.paymentReceipt?.summary}</p>
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

function PolicyPanel({
  configText,
  config,
  settings,
  busy,
  onSettingsChange,
  onSettingsDirty,
  onSaveSettings
}: {
  configText: string;
  config: AgentZcashConfig;
  settings: {
    requireEveryPayment: boolean;
    perTransactionZec: string;
    dailyZec: string;
    monthlyZec: string;
  };
  busy: boolean;
  onSettingsChange: React.Dispatch<
    React.SetStateAction<{
      requireEveryPayment: boolean;
      perTransactionZec: string;
      dailyZec: string;
      monthlyZec: string;
    }>
  >;
  onSettingsDirty: () => void;
  onSaveSettings: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>Policy</h2>
        <span className="status-tag neutral">
          {config.approval.requireEveryPayment ? "Approval required" : "Autonomous below limits"}
        </span>
      </div>
      <div className="settings-form">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={!settings.requireEveryPayment}
            onChange={(event) => {
              onSettingsDirty();
              onSettingsChange((current) => ({
                ...current,
                requireEveryPayment: !event.target.checked
              }));
            }}
          />
          <span>Autonomous payments</span>
        </label>
        <label>
          <span>Per transaction</span>
          <input
            inputMode="decimal"
            pattern="\\d+(\\.\\d{1,8})?"
            value={settings.perTransactionZec}
            onChange={(event) => {
              onSettingsDirty();
              onSettingsChange((current) => ({ ...current, perTransactionZec: event.target.value }));
            }}
          />
        </label>
        <label>
          <span>Daily</span>
          <input
            inputMode="decimal"
            pattern="\\d+(\\.\\d{1,8})?"
            value={settings.dailyZec}
            onChange={(event) => {
              onSettingsDirty();
              onSettingsChange((current) => ({ ...current, dailyZec: event.target.value }));
            }}
          />
        </label>
        <label>
          <span>Monthly</span>
          <input
            inputMode="decimal"
            pattern="\\d+(\\.\\d{1,8})?"
            value={settings.monthlyZec}
            onChange={(event) => {
              onSettingsDirty();
              onSettingsChange((current) => ({ ...current, monthlyZec: event.target.value }));
            }}
          />
        </label>
        <button className="primary-button" onClick={onSaveSettings} disabled={busy}>
          <Save size={15} />
          Save
        </button>
      </div>
      <pre className="config-preview">{configText}</pre>
    </section>
  );
}
