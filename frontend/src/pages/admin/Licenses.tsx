// Licences: search, grant, import, issue/rotate keys, product testers, revoke.

import { useState, type FormEvent } from "react";
import { api, type AdminLicense } from "../../api";
import { sourceLabel } from "../Account";
import { ActionMessage, Badge, Button, CopyButton, Empty, Field, Mono, Notice, Spinner, Time, confirmAction, useAction, useLoad } from "../../ui";

// `admin` false is the moderator view: no bulk import.
export function Licenses({ admin }: { admin: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [testersOnly, setTestersOnly] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () =>
      api.get<{ total: number; licenses: AdminLicense[] }>(
        `/api/admin/licenses?limit=200${query ? `&q=${encodeURIComponent(query)}` : ""}${testersOnly ? "&tester=1" : ""}`,
      ),
    [query, testersOnly],
  );
  const { busy, message, setMessage, run } = useAction();
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [tool, setTool] = useState<"grant" | "import" | null>(null);

  const licenses = data?.licenses ?? [];

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">{admin ? "Admin" : "Moderation"}</p>
          <h1>Licences</h1>
          {data && (
            <p className="muted small">
              {data.total} in total{(query || testersOnly) && ` · ${licenses.length} matching`}
            </p>
          )}
        </div>
        <div className="actions">
          <Button icon="key" variant={tool === "grant" ? "primary" : "ghost"} onClick={() => setTool(tool === "grant" ? null : "grant")}>
            Grant
          </Button>
          {admin && (
            <Button icon="upload" variant={tool === "import" ? "primary" : "ghost"} onClick={() => setTool(tool === "import" ? null : "import")}>
              Import
            </Button>
          )}
        </div>
      </header>

      {tool === "grant" && (
        <section className="card">
          <h2>Grant a licence</h2>
          <form
            className="form form-inline"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const id = form.get("creatorId");
              const tester = form.get("tester") === "true";
              void run(async () => {
                const r = await api.post<{ created: boolean }>("/api/admin/licenses", { creatorId: id, tester });
                await reload();
                const what = r.created ? `Licensed ${id}` : `${id} was already licensed`;
                return tester ? `${what}; they are a product tester.` : `${what}.`;
              });
            }}
          >
            <Field label="Roblox user id">
              <input name="creatorId" inputMode="numeric" pattern="[0-9]+" required placeholder="123456789" />
            </Field>
            <label className="check">
              <input type="checkbox" name="tester" value="true" /> product tester
            </label>
            <Button type="submit" variant="primary" busy={busy}>
              Grant
            </Button>
          </form>
        </section>
      )}

      {tool === "import" && (
        <section className="card">
          <h2>Import licences</h2>
          <p className="muted small">Paste Roblox user ids, one per line or separated by commas. Existing licences are left alone. Migrations from Parcel happen on the user's account page instead.</p>
          <form
            className="form"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const ids = new FormData(e.currentTarget).get("ids");
              const el = e.currentTarget;
              void run(async () => {
                const r = await api.post<{ given: number; created: number }>("/api/admin/licenses/import", { ids });
                el.reset();
                await reload();
                return `Imported ${r.created} new licence(s) out of ${r.given} id(s).`;
              });
            }}
          >
            <Field label="User ids">
              <textarea name="ids" rows={6} required placeholder={"123456789\n987654321"} className="mono" />
            </Field>
            <div className="actions">
              <Button type="submit" variant="primary" icon="upload" busy={busy}>
                Import
              </Button>
            </div>
          </form>
        </section>
      )}

      <ActionMessage message={message} onClose={() => setMessage(null)} />

      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by Roblox id, username, Discord name or key" aria-label="Search licences" />
        <Button type="submit">Search</Button>
        {query && (
          <Button
            onClick={() => {
              setQ("");
              setQuery("");
            }}
          >
            Clear
          </Button>
        )}
        <label className="check">
          <input type="checkbox" checked={testersOnly} onChange={(e) => setTestersOnly(e.target.checked)} /> testers only
        </label>
      </form>

      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}
      {data !== null && licenses.length === 0 && <Empty>No {testersOnly ? "product testers" : "licences"}{query && " match"}.</Empty>}

      {licenses.length > 0 && (
        <div className="table-wrap card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Roblox</th>
                <th>Discord</th>
                <th>Licensed</th>
                <th>Source</th>
                <th>Key</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l.creatorId}>
                  <td>
                    <a href={`https://www.roblox.com/users/${l.creatorId}/profile`} target="_blank" rel="noreferrer">
                      {l.robloxUsername ?? <span className="muted">unknown</span>}
                    </a>
                    <br />
                    <Mono>{l.creatorId}</Mono>
                    {l.tester && (
                      <>
                        {" "}
                        <Badge tone="accent">tester</Badge>
                      </>
                    )}
                  </td>
                  <td>
                    {l.discordUsername ?? <span className="muted">not signed in</span>}
                    {l.discordId && (
                      <>
                        <br />
                        <Mono>{l.discordId}</Mono>
                      </>
                    )}
                  </td>
                  <td>
                    <Time at={l.licensedAt} exact />
                  </td>
                  <td>
                    {sourceLabel(l.source)}
                    {l.issuedBy && (
                      <>
                        <br />
                        <Mono>{l.issuedBy}</Mono>
                      </>
                    )}
                  </td>
                  <td>
                    {l.hasKey ? (
                      <>
                        <Badge tone="ok">issued</Badge> <Time at={l.keyIssuedAt} />
                        {revealed[l.creatorId] && (
                          <div className="key-reveal">
                            <Mono>{revealed[l.creatorId]}</Mono> <CopyButton text={revealed[l.creatorId]} />
                          </div>
                        )}
                      </>
                    ) : (
                      <Badge>none</Badge>
                    )}
                  </td>
                  <td className="row-actions">
                    <Button
                      icon="flask"
                      busy={busy}
                      title={l.tester ? "Stop offering tester releases to this user" : "Offer tester releases to this user as well"}
                      onClick={() => void run(async () => {
                        await api.post(`/api/admin/licenses/${l.creatorId}/tester`, { tester: !l.tester });
                        await reload();
                        return l.tester ? `${l.creatorId} is no longer a product tester.` : `${l.creatorId} is now a product tester.`;
                      })}
                    >
                      {l.tester ? "Remove tester" : "Make tester"}
                    </Button>
                    <Button
                      icon="key"
                      busy={busy}
                      title={l.hasKey ? "Rotate: replaces the key, invalidating the old build" : "Issue the build key now"}
                      onClick={() => (l.hasKey ? confirmAction(`Rotate the key for ${l.creatorId}? Their current build stops working.`) : true) && void run(async () => {
                        const r = await api.post<{ key: string }>(`/api/admin/licenses/${l.creatorId}/key`, { rotate: l.hasKey });
                        setRevealed((m) => ({ ...m, [l.creatorId]: r.key }));
                        await reload();
                        return `${l.hasKey ? "Rotated" : "Issued"} key for ${l.creatorId}. It is shown once below.`;
                      })}
                    >
                      {l.hasKey ? "Rotate" : "Issue key"}
                    </Button>
                    <Button
                      variant="danger"
                      icon="trash"
                      busy={busy}
                      onClick={() => confirmAction(`Revoke ${l.creatorId}'s licence? Their key and builds are deleted.`) && void run(async () => {
                        await api.delete(`/api/admin/licenses/${l.creatorId}`);
                        await reload();
                        return `Revoked ${l.creatorId}.`;
                      })}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
