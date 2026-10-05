// Admin settings: Bloxlink, Parcel, obfuscation, retention.

import { useEffect, useState, type FormEvent } from "react";
import { api, type Settings as SettingsData } from "../../api";
import { ActionMessage, Button, Field, Mono, Notice, Spinner, useAction, useLoad } from "../../ui";

export function Settings() {
  const { data, error, loading, reload } = useLoad(() => api.get<{ settings: SettingsData }>("/api/admin/settings"));
  const { busy, message, setMessage, run } = useAction();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      const s: Record<string, string> = { ...data.settings } as unknown as Record<string, string>;
      for (const key of data.settings._secrets) s[key] = "";
      setForm(s);
    }
  }, [data]);

  if (loading && data === null) return <Spinner />;
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (data === null) return null;

  const set = (key: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const secretHint = (key: keyof SettingsData) => (data.settings[key] ? `Currently ${String(data.settings[key])}. Leave blank to keep.` : "Not set.");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api.put<{ changed: string[] }>("/api/admin/settings", form);
      await reload();
      return r.changed.length === 0 ? "Nothing changed." : `Saved ${r.changed.join(", ")}.`;
    });
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Settings</h1>
        </div>
      </header>

      <form className="form settings" onSubmit={(e) => void submit(e)}>
        <section className="card">
          <h2>Bloxlink</h2>
          <p className="muted small">Discord → Roblox lookups run against one guild. The user must be a member and verified there. Results are cached per user until they ask for a re-check.</p>
          <div className="form-row">
            <Field label="Guild id" hint="The Discord server id.">
              <input value={form.bloxlink_guild_id ?? ""} onChange={set("bloxlink_guild_id")} inputMode="numeric" placeholder="123456789012345678" />
            </Field>
            <Field label="Server API key" hint={secretHint("bloxlink_api_key")}>
              <input value={form.bloxlink_api_key ?? ""} onChange={set("bloxlink_api_key")} type="password" autoComplete="off" placeholder="from blox.link/dashboard → Developer API" />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>Parcel migration</h2>
          <p className="muted small">
            Uses Parcel's v1 whitelist check (<Mono>whitelist.parcelroblox.com/v1/check</Mono>); no secret needed. Find the ids with <Mono>/products</Mono> and <Mono>/update &lt;product&gt;</Mono> in the Parcel bot.
          </p>
          <label className="check">
            <input type="checkbox" checked={form.parcel_enabled === "true"} onChange={(e) => setForm((f) => ({ ...f, parcel_enabled: String(e.target.checked) }))} /> let users claim a Parcel purchase
          </label>
          <div className="form-row">
            <Field label="Hub id">
              <input value={form.parcel_hub_id ?? ""} onChange={set("parcel_hub_id")} className="mono" />
            </Field>
            <Field label="Product id">
              <input value={form.parcel_product_id ?? ""} onChange={set("parcel_product_id")} className="mono" />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>Builds and obfuscation</h2>
          <p className="muted small">On download the marker is replaced with the user's key and the script is sent to nyxyl's Umbra API. Change the mode or scope and use "Drop cached builds" on a release for it to take effect.</p>
          <div className="form-row">
            <Field label="Key marker" hint="The literal to replace inside scripts.">
              <input value={form.key_marker ?? ""} onChange={set("key_marker")} className="mono" />
            </Field>
            <Field label="nyxyl API key" hint={secretHint("nyxyl_api_key")}>
              <input value={form.nyxyl_api_key ?? ""} onChange={set("nyxyl_api_key")} type="password" autoComplete="off" placeholder="umbra_…" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Mode">
              <select value={form.obfuscate_mode ?? "vm"} onChange={set("obfuscate_mode")}>
                <option value="vm">vm — bytecode virtualisation (strongest)</option>
                <option value="register">register — Register VM</option>
                <option value="minify">minify — rename and compress only</option>
                <option value="none">none — key substitution only, no obfuscation</option>
              </select>
            </Field>
            <Field label="Scope">
              <select value={form.obfuscate_scope ?? "marked"} onChange={set("obfuscate_scope")}>
                <option value="marked">only scripts containing the marker</option>
                <option value="all">every script in the model</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>Retention</h2>
          <div className="form-row">
            <Field label="Telemetry retention (days)" hint="Older pings are deleted by the nightly job. Info logs are always dropped after 24 h.">
              <input value={form.telemetry_retention_days ?? "30"} onChange={set("telemetry_retention_days")} inputMode="numeric" />
            </Field>
          </div>
        </section>

        <div className="actions sticky-actions">
          <Button type="submit" variant="primary" icon="check" busy={busy}>
            Save settings
          </Button>
          <ActionMessage message={message} onClose={() => setMessage(null)} />
        </div>
      </form>
    </>
  );
}
