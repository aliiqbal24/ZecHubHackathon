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
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Terminal,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityEvent,
  AgentWalletBackend,
  Purchase,
  ShippingProfile,
  VerificationMode,
  WalletPresetName,
  WalletState,
  ZecGuardConfig,
  ZecGuardState
} from "@zecguard/core";

interface DashboardPayload {
  config: ZecGuardConfig;
  configText: string;
  state: ZecGuardState;
}

type DashboardView = "activity" | "settings";

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

function cloneConfig(config: ZecGuardConfig): ZecGuardConfig {
  return JSON.parse(JSON.stringify(config)) as ZecGuardConfig;
}

function blankProfile(): ShippingProfile {
  return {
    id: `profile-${Date.now()}`,
    label: "New profile",
    name: "",
    line1: "",
    city: "",
    region: "",
    postalCode: "",
    country: "US"
  };
}

function setOptional(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

export function DashboardClient() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [view, setView] = useState<DashboardView>("activity");
  const [requestText, setRequestText] = useState(
    "Buy a private AI briefing about how ZEC-native vendors can accept agent purchases."
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [configForm, setConfigForm] = useState<ZecGuardConfig | null>(null);
  const [lastLoadedConfig, setLastLoadedConfig] = useState<ZecGuardConfig | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    const json = (await response.json()) as DashboardPayload;
    setPayload(json);
    setLastLoadedConfig(cloneConfig(json.config));
    setConfigForm((current) => (current && settingsDirty ? current : cloneConfig(json.config)));
  }, [settingsDirty]);

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

  function updateConfig(mutator: (draft: ZecGuardConfig) => void) {
    if (!configForm) return;
    const next = cloneConfig(configForm);
    mutator(next);
    setConfigForm(next);
    setSettingsDirty(true);
    setSettingsError(null);
  }

  async function saveSettings() {
    if (!configForm) return;
    setBusy("settings");
    setSettingsError(null);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(configForm)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error ?? "Unable to save settings.");
      }

      const stateResponse = await fetch("/api/state", { cache: "no-store" });
      const nextPayload = (await stateResponse.json()) as DashboardPayload;
      setPayload(nextPayload);
      setConfigForm(cloneConfig(nextPayload.config));
      setLastLoadedConfig(cloneConfig(nextPayload.config));
      setSettingsDirty(false);
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "Unable to save settings.");
    } finally {
      setBusy(null);
    }
  }

  function resetSettings() {
    if (!lastLoadedConfig) return;
    setConfigForm(cloneConfig(lastLoadedConfig));
    setSettingsDirty(false);
    setSettingsError(null);
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

  if (!payload || !configForm) {
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

      <nav className="view-tabs" aria-label="Dashboard view">
        <button className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>
          <Activity size={15} />
          Activity
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
          <Settings size={15} />
          Settings
        </button>
      </nav>

      {view === "activity" ? (
        <ActivityView
          requestText={requestText}
          setRequestText={setRequestText}
          pendingPurchases={pendingPurchases}
          receipts={receipts}
          payload={payload}
          busy={busy}
          onRequestPurchase={requestPurchase}
          onApprove={approve}
          onReject={reject}
        />
      ) : (
        <SettingsView
          config={configForm}
          configText={payload.configText}
          dirty={settingsDirty}
          busy={busy === "settings"}
          error={settingsError}
          onChange={updateConfig}
          onSave={() => void saveSettings()}
          onReset={resetSettings}
        />
      )}
    </main>
  );
}

function ActivityView({
  requestText,
  setRequestText,
  pendingPurchases,
  receipts,
  payload,
  busy,
  onRequestPurchase,
  onApprove,
  onReject
}: {
  requestText: string;
  setRequestText: (value: string) => void;
  pendingPurchases: Purchase[];
  receipts: Purchase[];
  payload: DashboardPayload;
  busy: string | null;
  onRequestPurchase: () => void;
  onApprove: (purchase: Purchase) => void;
  onReject: (purchase: Purchase) => void;
}) {
  return (
    <>
      <section className="workspace-grid">
        <section className="panel purchase-panel">
          <div className="panel-heading">
            <div>
              <h2>Agent request</h2>
              <p>Natural-language intent converted into a ZEC Harness purchase.</p>
            </div>
            <button className="primary-button" onClick={onRequestPurchase} disabled={busy !== null}>
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
                  onApprove={() => onApprove(purchase)}
                  onReject={() => onReject(purchase)}
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
    </>
  );
}

function SettingsView({
  config,
  configText,
  dirty,
  busy,
  error,
  onChange,
  onSave,
  onReset
}: {
  config: ZecGuardConfig;
  configText: string;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  onChange: (mutator: (draft: ZecGuardConfig) => void) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <section className="settings-layout">
      <div className="settings-main">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Spending limits</h2>
              <p>Configured in ZEC and enforced before approval.</p>
            </div>
          </div>
          <div className="form-grid three">
            <TextField
              label="Per transaction"
              value={config.spending.perTransactionZec}
              onChange={(value) => onChange((draft) => void (draft.spending.perTransactionZec = value))}
            />
            <TextField
              label="Daily"
              value={config.spending.dailyZec}
              onChange={(value) => onChange((draft) => void (draft.spending.dailyZec = value))}
            />
            <TextField
              label="Monthly"
              value={config.spending.monthlyZec}
              onChange={(value) => onChange((draft) => void (draft.spending.monthlyZec = value))}
            />
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Approval, vendors, privacy</h2>
              <p>Controls for local user review and vendor trust.</p>
            </div>
          </div>
          <div className="toggle-grid">
            <CheckboxField
              label="Require every payment"
              checked={config.approval.requireEveryPayment}
              onChange={(checked) => onChange((draft) => void (draft.approval.requireEveryPayment = checked))}
            />
            <CheckboxField
              label="Allow one-time override"
              checked={config.approval.allowOneTimeOverride}
              onChange={(checked) => onChange((draft) => void (draft.approval.allowOneTimeOverride = checked))}
            />
            <CheckboxField
              label="Allow unknown vendors"
              checked={config.vendors.allowUnknownVendors}
              onChange={(checked) => onChange((draft) => void (draft.vendors.allowUnknownVendors = checked))}
            />
            <CheckboxField
              label="Show privacy labels"
              checked={config.privacy.showPrivacyLabel}
              onChange={(checked) => onChange((draft) => void (draft.privacy.showPrivacyLabel = checked))}
            />
          </div>

          <div className="list-editor">
            <div className="list-heading">
              <h3>Trusted vendor URLs</h3>
              <button
                className="mini-button"
                onClick={() => onChange((draft) => void draft.vendors.trusted.push("http://localhost:3020"))}
                aria-label="Add trusted vendor"
              >
                <Plus size={14} />
              </button>
            </div>
            {config.vendors.trusted.length ? (
              config.vendors.trusted.map((vendor, index) => (
                <div className="array-row" key={`${vendor}-${index}`}>
                  <input
                    value={vendor}
                    onChange={(event) =>
                      onChange((draft) => {
                        draft.vendors.trusted[index] = event.target.value;
                      })
                    }
                    aria-label={`Trusted vendor ${index + 1}`}
                  />
                  <button
                    className="mini-button"
                    onClick={() => onChange((draft) => void draft.vendors.trusted.splice(index, 1))}
                    aria-label="Remove trusted vendor"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-state compact">No trusted vendors configured.</div>
            )}
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Wallet</h2>
              <p>Agent identity, mode, and advanced CLI wallet controls.</p>
            </div>
          </div>
          <div className="form-grid three">
            <TextField
              label="Agent name"
              value={config.agent.name}
              onChange={(value) => onChange((draft) => void (draft.agent.name = value))}
            />
            <SelectField
              label="Wallet mode"
              value={config.agent.walletMode}
              onChange={(value) =>
                onChange((draft) => {
                  draft.agent.walletMode = value as ZecGuardConfig["agent"]["walletMode"];
                })
              }
              options={[
                ["mock", "Mock"],
                ["external-cli", "External CLI"]
              ]}
            />
            <TextField
              label="Wallet address"
              value={config.agent.walletAddress}
              onChange={(value) => onChange((draft) => void (draft.agent.walletAddress = value))}
            />
          </div>

          <div className="advanced-section">
            <h3>Advanced wallet fields</h3>
            <div className="form-grid two">
              <SelectField
                label="Wallet preset"
                value={config.agent.walletPreset ?? ""}
                onChange={(value) =>
                  onChange((draft) => {
                    if (value) {
                      draft.agent.walletPreset = value as WalletPresetName;
                    } else {
                      delete draft.agent.walletPreset;
                    }
                  })
                }
                options={[
                  ["", "None"],
                  ["zodl", "Zodl"],
                  ["zingo-cli", "Zingo CLI"],
                  ["zallet", "Zallet"]
                ]}
              />
              <SelectField
                label="Agent wallet backend"
                value={config.agentWallet.backend}
                onChange={(value) =>
                  onChange((draft) => {
                    draft.agentWallet.backend = value as AgentWalletBackend;
                  })
                }
                options={[
                  ["mock", "Mock"],
                  ["zingo-cli", "Zingo CLI"]
                ]}
              />
              <TextField
                label="Agent wallet label"
                value={config.agentWallet.label ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agentWallet.label = setOptional(value)))}
              />
              <TextField
                label="Wallet ID"
                value={config.agentWallet.walletId ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agentWallet.walletId = setOptional(value)))}
              />
              <TextField
                label="Zingo CLI path"
                value={config.agentWallet.zingoCliPath ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agentWallet.zingoCliPath = setOptional(value)))}
              />
              <TextField
                label="Zingo server URL"
                value={config.agentWallet.zingoServerUrl ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agentWallet.zingoServerUrl = setOptional(value)))}
              />
              <TextField
                label="Main return address"
                value={config.agentWallet.mainReturnAddress ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agentWallet.mainReturnAddress = setOptional(value)))}
              />
            </div>
            <div className="form-grid three">
              <TextField
                label="Send command"
                value={config.agent.externalCliCommand ?? ""}
                onChange={(value) => onChange((draft) => void (draft.agent.externalCliCommand = setOptional(value)))}
              />
              <TextField
                label="Balance command"
                value={config.agent.externalCliBalanceCommand ?? ""}
                onChange={(value) =>
                  onChange((draft) => void (draft.agent.externalCliBalanceCommand = setOptional(value)))
                }
              />
              <TextField
                label="TX check command"
                value={config.agent.externalCliTxCheckCommand ?? ""}
                onChange={(value) =>
                  onChange((draft) => void (draft.agent.externalCliTxCheckCommand = setOptional(value)))
                }
              />
            </div>
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Verification</h2>
              <p>Receipt and payment confirmation settings.</p>
            </div>
          </div>
          <div className="form-grid two">
            <SelectField
              label="Mode"
              value={config.verification?.mode ?? "mock"}
              onChange={(value) =>
                onChange((draft) => {
                  draft.verification ??= { mode: "mock", minConfirmations: 1 };
                  draft.verification.mode = value as VerificationMode;
                })
              }
              options={[
                ["mock", "Mock"],
                ["external-cli", "External CLI"],
                ["lightwalletd", "Lightwalletd"]
              ]}
            />
            <TextField
              label="Minimum confirmations"
              type="number"
              min={1}
              value={String(config.verification?.minConfirmations ?? 1)}
              onChange={(value) =>
                onChange((draft) => {
                  draft.verification ??= { mode: "mock", minConfirmations: 1 };
                  draft.verification.minConfirmations = Number(value);
                })
              }
            />
            <TextField
              label="Lightwalletd URL"
              value={config.verification?.lightwalletdUrl ?? ""}
              onChange={(value) =>
                onChange((draft) => {
                  draft.verification ??= { mode: "mock", minConfirmations: 1 };
                  draft.verification.lightwalletdUrl = setOptional(value);
                })
              }
            />
            <TextField
              label="Viewing key"
              value={config.verification?.viewingKey ?? ""}
              onChange={(value) =>
                onChange((draft) => {
                  draft.verification ??= { mode: "mock", minConfirmations: 1 };
                  draft.verification.viewingKey = setOptional(value);
                })
              }
            />
            <TextField
              label="External verification command"
              value={config.verification?.externalCliCommand ?? ""}
              onChange={(value) =>
                onChange((draft) => {
                  draft.verification ??= { mode: "mock", minConfirmations: 1 };
                  draft.verification.externalCliCommand = setOptional(value);
                })
              }
            />
          </div>
        </section>

        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h2>Shipping profiles</h2>
              <p>Profiles used when a purchase requires PII for fulfillment.</p>
            </div>
            <button className="secondary-button" onClick={() => onChange((draft) => void draft.shippingProfiles.push(blankProfile()))}>
              <Plus size={15} />
              Add profile
            </button>
          </div>
          <div className="profile-list">
            {config.shippingProfiles.length ? (
              config.shippingProfiles.map((profile, index) => (
                <article className="profile-card" key={profile.id || index}>
                  <div className="profile-heading">
                    <strong>{profile.label || `Profile ${index + 1}`}</strong>
                    <button
                      className="mini-button"
                      onClick={() => onChange((draft) => void draft.shippingProfiles.splice(index, 1))}
                      aria-label="Remove shipping profile"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="form-grid three">
                    {profileField("ID", profile.id, (value, draft) => void (draft.shippingProfiles[index]!.id = value), onChange)}
                    {profileField("Label", profile.label, (value, draft) => void (draft.shippingProfiles[index]!.label = value), onChange)}
                    {profileField("Name", profile.name, (value, draft) => void (draft.shippingProfiles[index]!.name = value), onChange)}
                    {profileField("Line 1", profile.line1, (value, draft) => void (draft.shippingProfiles[index]!.line1 = value), onChange)}
                    {profileField(
                      "Line 2",
                      profile.line2 ?? "",
                      (value, draft) => void (draft.shippingProfiles[index]!.line2 = setOptional(value)),
                      onChange
                    )}
                    {profileField("City", profile.city, (value, draft) => void (draft.shippingProfiles[index]!.city = value), onChange)}
                    {profileField("Region", profile.region, (value, draft) => void (draft.shippingProfiles[index]!.region = value), onChange)}
                    {profileField(
                      "Postal code",
                      profile.postalCode,
                      (value, draft) => void (draft.shippingProfiles[index]!.postalCode = value),
                      onChange
                    )}
                    {profileField("Country", profile.country, (value, draft) => void (draft.shippingProfiles[index]!.country = value), onChange)}
                    {profileField(
                      "Email",
                      profile.email ?? "",
                      (value, draft) => void (draft.shippingProfiles[index]!.email = setOptional(value)),
                      onChange
                    )}
                    {profileField(
                      "Phone",
                      profile.phone ?? "",
                      (value, draft) => void (draft.shippingProfiles[index]!.phone = setOptional(value)),
                      onChange
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No shipping profiles configured.</div>
            )}
          </div>
        </section>
      </div>

      <aside className="settings-side">
        <section className="panel settings-actions">
          <div>
            <h2>Settings</h2>
            <p>{dirty ? "Unsaved local edits" : "Saved to zecguard.config.yaml"}</p>
          </div>
          {error ? (
            <div className="error-banner inline">
              <AlertTriangle size={16} />
              {error}
            </div>
          ) : null}
          <div className="settings-buttons">
            <button className="primary-button" onClick={onSave} disabled={busy || !dirty}>
              <Save size={15} />
              Save settings
            </button>
            <button className="secondary-button" onClick={onReset} disabled={busy || !dirty}>
              <RotateCcw size={15} />
              Reset changes
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading compact">
            <h2>Effective YAML</h2>
            <span className="status-tag neutral">read only</span>
          </div>
          <pre className="config-preview settings-preview">{configText}</pre>
        </section>
      </aside>
    </section>
  );
}

function profileField(
  label: string,
  value: string,
  apply: (value: string, draft: ZecGuardConfig) => void,
  onChange: (mutator: (draft: ZecGuardConfig) => void) => void
) {
  return <TextField key={label} label={label} value={value} onChange={(next) => onChange((draft) => apply(next, draft))} />;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  min
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} min={min} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="checkbox-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
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
