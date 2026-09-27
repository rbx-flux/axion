// Signed-in Discord accounts and the deletion flow.

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type AdminUser } from "../../api";
import { ActionMessage, Badge, Button, Empty, Mono, Notice, Spinner, Time, confirmAction, useAction, useLoad } from "../../ui";

export function Users() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [q, setQ] = useState(query);
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ users: AdminUser[] }>(`/api/admin/users?limit=200${query ? `&q=${encodeURIComponent(query)}` : ""}`),
    [query],
  );
  const { busy, message, setMessage, run } = useAction();
  const users = data?.users ?? [];

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Users</h1>
          <p className="muted small">Everyone who has signed in with Discord. Licences live on the Roblox id; a user without a Roblox link cannot download.</p>
        </div>
        <Button icon="refresh" onClick={() => void reload()} busy={loading}>
          Refresh
        </Button>
      </header>

      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(q.trim() ? { q: q.trim() } : {});
        }}
      >
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Discord id or name, Roblox id or name" aria-label="Search users" />
        <Button type="submit">Search</Button>
        {query && (
          <Button
            onClick={() => {
              setQ("");
              setParams({});
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <ActionMessage message={message} onClose={() => setMessage(null)} />
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}
      {data !== null && users.length === 0 && <Empty>No users{query && " match"}.</Empty>}

      {users.length > 0 && (
        <div className="table-wrap card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Discord</th>
                <th>Roblox</th>
                <th>Licence</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.discordId}>
                  <td>
                    <span className="identity-sm">
                      {u.avatar && <img src={u.avatar} alt="" width={20} height={20} />}
                      <strong>{u.username}</strong>
                      {u.admin ? <Badge tone="accent">admin</Badge> : u.moderator && <Badge tone="info">moderator</Badge>}
                    </span>
                    <br />
                    <Mono>{u.discordId}</Mono>
                  </td>
                  <td>
                    {u.robloxId === null ? (
                      <>
                        <Badge tone="warn">not linked</Badge>
                        {u.bloxlinkError && (
                          <>
                            <br />
                            <span className="muted small">{u.bloxlinkError}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <a href={`https://www.roblox.com/users/${u.robloxId}/profile`} target="_blank" rel="noreferrer">
                          {u.robloxUsername ?? "profile"}
                        </a>
                        <br />
                        <Mono>{u.robloxId}</Mono>
                      </>
                    )}
                    <br />
                    <span className="muted small">
                      checked <Time at={u.bloxlinkCheckedAt} />
                    </span>
                  </td>
                  <td>{u.licensed ? <Badge tone="ok">licensed</Badge> : <Badge>none</Badge>}</td>
                  <td>
                    <Time at={u.lastLoginAt} exact />
                    <br />
                    <span className="muted small">
                      first <Time at={u.createdAt} />
                    </span>
                  </td>
                  <td className="row-actions">
                    <Button
                      variant="danger"
                      icon="trash"
                      busy={busy}
                      onClick={() => {
                        if (!confirmAction(`Delete ${u.username}'s account and sessions?`)) return;
                        const withLicense = u.licensed && confirmAction("Also delete their licence, key, builds and telemetry? (Cancel keeps the licence.)");
                        void run(async () => {
                          await api.delete(`/api/admin/users/${u.discordId}?license=${withLicense}`);
                          await reload();
                          return `Deleted ${u.username}${withLicense ? " including licence" : ""}.`;
                        });
                      }}
                    >
                      Delete
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
