// Releases: upload an .rbxmx, publish/unpublish, move between the production
// and tester channels, drop cached builds.

import { useState, type FormEvent } from "react";
import { api, type Release } from "../../api";
import { ActionMessage, Badge, Button, Empty, Field, Mono, Notice, Spinner, Time, confirmAction, formatBytes, useAction, useLoad } from "../../ui";

export function Files() {
  const { data, error, loading, reload } = useLoad(() => api.get<{ files: Release[] }>("/api/admin/files"));
  const { busy, message, setMessage, run } = useAction();
  const files = data?.files ?? [];

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Releases</h1>
        </div>
        <Button icon="refresh" onClick={() => void reload()} busy={loading}>
          Refresh
        </Button>
      </header>

      <UploadCard onDone={reload} />

      <ActionMessage message={message} onClose={() => setMessage(null)} />
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}
      {data !== null && files.length === 0 && <Empty>No releases uploaded yet.</Empty>}

      {files.map((f) => (
        <section key={f.id} className={`card release-card${f.channel === "tester" ? " card-tester" : ""}`} aria-label={f.name}>
          <div className="card-head">
            <div>
              <h2>
                {f.name} {f.version && <Mono>{f.version}</Mono>}
              </h2>
              <p className="muted small">
                <Mono>{f.id}</Mono> · {formatBytes(f.size)} · uploaded <Time at={f.uploadedAt} exact /> by <Mono>{f.uploadedBy}</Mono> · {f.builds ?? 0} cached build(s)
              </p>
            </div>
            <div className="badges">
              {f.channel === "tester" ? <Badge tone="accent">testers only</Badge> : <Badge tone="info">production</Badge>}
              {f.published ? <Badge tone="ok">published</Badge> : <Badge>draft</Badge>}
              {f.markerHits === 0 ? <Badge tone="bad">no key marker</Badge> : <Badge tone="info">{f.markerHits} keyed script(s)</Badge>}
            </div>
          </div>
          {f.notes && <p className="release-notes">{f.notes}</p>}
          {f.markerHits === 0 && (
            <Notice tone="warn">
              No script in this file contains the key marker. Downloads would carry no licence key and could not be traced. Fix the model and upload again.
            </Notice>
          )}
          <div className="actions">
            <Button
              variant={f.published ? "ghost" : "primary"}
              icon={f.published ? "x" : "check"}
              busy={busy}
              onClick={() => void run(async () => {
                await api.patch(`/api/admin/files/${f.id}`, { published: !f.published });
                await reload();
                return f.published ? `Unpublished ${f.name}.` : `Published ${f.name}.`;
              })}
            >
              {f.published ? "Unpublish" : "Publish"}
            </Button>
            <Button
              icon={f.channel === "tester" ? "download" : "flask"}
              busy={busy}
              title={f.channel === "tester" ? "Offer this release to every licensee" : "Offer this release only to product testers"}
              onClick={() => (f.channel === "tester" && f.published ? confirmAction(`Promote ${f.name} to production? Every licensee will be able to download it.`) : true) && void run(async () => {
                const channel = f.channel === "tester" ? "release" : "tester";
                await api.patch(`/api/admin/files/${f.id}`, { channel });
                await reload();
                return channel === "tester" ? `${f.name} is now for testers only.` : `Promoted ${f.name} to production.`;
              })}
            >
              {f.channel === "tester" ? "Promote to production" : "Move to testers"}
            </Button>
            <Button
              icon="refresh"
              busy={busy}
              onClick={() => void run(async () => {
                const r = await api.post<{ cleared: number }>(`/api/admin/files/${f.id}/rebuild`);
                await reload();
                return `Dropped ${r.cleared} cached build(s); next downloads rebuild.`;
              })}
            >
              Drop cached builds
            </Button>
            <Button
              variant="danger"
              icon="trash"
              busy={busy}
              onClick={() => confirmAction(`Delete ${f.name} and all its builds? Users lose this download.`) && void run(async () => {
                await api.delete(`/api/admin/files/${f.id}`);
                await reload();
                return `Deleted ${f.name}.`;
              })}
            >
              Delete
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}

function UploadCard({ onDone }: { onDone: () => Promise<void> }) {
  const { busy, message, setMessage, run } = useAction();
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const el = event.currentTarget;
    await run(async () => {
      const r = await api.upload<{ markerHits: number; marker: string; file: Release | null }>("/api/admin/files", form);
      el.reset();
      await onDone();
      return r.markerHits === 0
        ? `Uploaded, but no script contains ${r.marker}. It is saved as a draft.`
        : `Uploaded: ${r.markerHits} script(s) carry ${r.marker}.`;
    });
  }

  return (
    <section className="card" aria-labelledby="up-h">
      <div className="card-head">
        <h2 id="up-h">Upload a release</h2>
        <Button icon={open ? "x" : "upload"} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "New upload"}
        </Button>
      </div>
      {open && (
        <form className="form" onSubmit={(e) => void submit(e)}>
          <Notice tone="info">
            Only <strong>.rbxmx</strong> (Roblox XML model) is accepted, so the key can be written into the scripts. Put the key marker (default <Mono>__LICENSE_KEY</Mono>, see Settings) in a string in the script that reads it. On download it is replaced with the user's key and the script is obfuscated.
          </Notice>
          <Field label="File (.rbxmx)">
            <input name="file" type="file" accept=".rbxmx,application/xml,text/xml" required />
          </Field>
          <div className="form-row">
            <Field label="Name" hint="Shown to users and used as the download filename.">
              <input name="name" type="text" placeholder="Orbit.rbxmx" maxLength={120} />
            </Field>
            <Field label="Version">
              <input name="version" type="text" placeholder="3.2.0" maxLength={40} />
            </Field>
          </div>
          <Field label="Notes" hint="Optional; users see this next to the download.">
            <textarea name="notes" rows={3} maxLength={2000} />
          </Field>
          <Field label="Channel" hint="Tester releases are non-production builds that only product testers (set on the Licences page) can see and download.">
            <select name="channel" defaultValue="release">
              <option value="release">Production — every licensee</option>
              <option value="tester">Testers only</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" name="published" value="true" /> publish immediately
          </label>
          <div className="actions">
            <Button type="submit" variant="primary" icon="upload" busy={busy}>
              Upload
            </Button>
          </div>
        </form>
      )}
      <ActionMessage message={message} onClose={() => setMessage(null)} />
    </section>
  );
}
