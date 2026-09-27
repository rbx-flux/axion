// Security alarms, grouped user → key → game so a leaked build reads as one
// block instead of hundreds of rows. Deletion requests are listed first.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Alarm } from "../../api";
import { ActionMessage, Badge, Button, Empty, LevelBadge, Mono, Notice, Spinner, Time, confirmAction, useAction, useLoad } from "../../ui";

const KIND_LABEL: Record<Alarm["kind"], string> = {
  key_mismatch: "key belongs to another user",
  unknown_key: "key was never issued",
  unlicensed: "unlicensed user",
  deletion_request: "data deletion request",
};

export function Alarms() {
  const [showCleared, setShowCleared] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ alarms: Alarm[] }>(`/api/admin/alarms?cleared=${showCleared}`),
    [showCleared],
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { busy, message, setMessage, run } = useAction();

  const alarms = data?.alarms ?? [];
  const deletions = alarms.filter((a) => a.kind === "deletion_request");
  const security = alarms.filter((a) => a.kind !== "deletion_request");
  const groups = useMemo(() => groupAlarms(security), [security]);

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleMany(ids: number[]) {
    setSelected((s) => {
      const next = new Set(s);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) allIn ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function clear(body: { ids?: number[]; all?: boolean }) {
    await run(async () => {
      const r = await api.post<{ cleared: number }>("/api/admin/alarms/clear", body);
      setSelected(new Set());
      await reload();
      return `Cleared ${r.cleared} alarm(s).`;
    });
  }

  const openCount = alarms.filter((a) => a.clearedAt === null).length;

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Alarms</h1>
        </div>
        <div className="actions">
          <label className="check">
            <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} /> show cleared
          </label>
          <Button icon="refresh" onClick={() => void reload()} busy={loading}>
            Refresh
          </Button>
          <Button variant="danger" icon="check" disabled={openCount === 0} busy={busy} onClick={() => confirmAction(`Clear all ${openCount} open alarms?`) && void clear({ all: true })}>
            Clear all open
          </Button>
        </div>
      </header>

      <ActionMessage message={message} onClose={() => setMessage(null)} />
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}

      {deletions.length > 0 && (
        <section className="card" aria-labelledby="del-h">
          <div className="card-head">
            <h2 id="del-h">Deletion requests</h2>
            <Badge tone="warn">{deletions.length}</Badge>
          </div>
          <ul className="plain-list">
            {deletions.map((a) => {
              const who = parseDetail(a.detail);
              return (
                <li key={a.id} className="row">
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`select request ${a.id}`} disabled={a.clearedAt !== null} />
                  <div className="grow">
                    <strong>{who.username ?? "unknown"}</strong> <Mono>{who.discordId ?? "?"}</Mono>
                    {a.creatorId !== null && (
                      <>
                        {" "}
                        · Roblox <Mono>{a.creatorId}</Mono>
                      </>
                    )}
                    <div className="muted small">
                      asked <Time at={a.firstSeen} exact />
                      {a.count > 1 && ` · asked ${a.count}×`}
                      {a.clearedAt !== null && (
                        <>
                          {" "}
                          · cleared <Time at={a.clearedAt} /> by <Mono>{a.clearedBy}</Mono>
                        </>
                      )}
                    </div>
                  </div>
                  {who.discordId && a.clearedAt === null && (
                    <Link to={`/admin/users?q=${who.discordId}`} className="btn btn-ghost btn-sm">
                      <span>Handle in Users</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data !== null && security.length === 0 && deletions.length === 0 && <Empty>No alarms. Everything is where it should be.</Empty>}

      {groups.map((g) => {
        const ids = g.alarms.map((a) => a.id).filter((id) => alarms.find((a) => a.id === id)?.clearedAt === null);
        return (
          <section key={g.key} className="card alarm-group" aria-label={`alarms for ${g.creatorId ?? "unknown user"}`}>
            <div className="card-head">
              <label className="check">
                <input type="checkbox" checked={ids.length > 0 && ids.every((id) => selected.has(id))} onChange={() => toggleMany(ids)} disabled={ids.length === 0} aria-label="select group" />
                <span>
                  user <Mono>{g.creatorId ?? "—"}</Mono>
                  {g.presentedKey !== null && (
                    <>
                      {" "}
                      presented key <Mono>{g.presentedKey}</Mono>
                    </>
                  )}
                  {g.keyOwnerId !== null && (
                    <>
                      {" "}
                      owned by <Mono>{g.keyOwnerId}</Mono>
                    </>
                  )}
                </span>
              </label>
              <span className="muted small">
                {g.hits} {g.hits === 1 ? "hit" : "hits"} · last <Time at={g.lastSeen} />
              </span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>Game</th>
                    <th>Kind</th>
                    <th>Level</th>
                    <th className="num">Count</th>
                    <th>First</th>
                    <th>Last</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {g.games.map((game) =>
                    game.alarms.map((a, i) => (
                      <tr key={a.id} className={a.clearedAt !== null ? "dim-row" : ""}>
                        <td>
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} disabled={a.clearedAt !== null} aria-label={`select alarm ${a.id}`} />
                        </td>
                        <td>{i === 0 ? game.gameId === null ? <span className="muted">no game id</span> : <a href={`https://www.roblox.com/games/${game.gameId}`} target="_blank" rel="noreferrer"><Mono>{game.gameId}</Mono></a> : ""}</td>
                        <td>{KIND_LABEL[a.kind]}</td>
                        <td>
                          <LevelBadge level={a.level} />
                        </td>
                        <td className="num">{a.count}</td>
                        <td>
                          <Time at={a.firstSeen} exact />
                        </td>
                        <td>
                          <Time at={a.lastSeen} />
                        </td>
                        <td>{a.clearedAt === null ? <Badge tone="warn">open</Badge> : <span className="muted small">cleared <Time at={a.clearedAt} /></span>}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {selected.size > 0 && (
        <div className="action-bar" role="toolbar" aria-label="Selected alarms">
          <span>{selected.size} selected</span>
          <Button variant="primary" icon="check" busy={busy} onClick={() => void clear({ ids: [...selected] })}>
            Clear selected
          </Button>
          <Button onClick={() => setSelected(new Set())}>Deselect</Button>
        </div>
      )}
    </>
  );
}

interface GameGroup {
  gameId: number | null;
  alarms: Alarm[];
}
interface UserGroup {
  key: string;
  creatorId: number | null;
  presentedKey: string | null;
  keyOwnerId: number | null;
  hits: number;
  lastSeen: number;
  games: GameGroup[];
  alarms: Alarm[];
}

function groupAlarms(alarms: Alarm[]): UserGroup[] {
  const map = new Map<string, UserGroup>();
  for (const a of alarms) {
    const key = `${a.creatorId ?? "-"}|${a.key ?? "-"}`;
    let g = map.get(key);
    if (!g) {
      g = { key, creatorId: a.creatorId, presentedKey: a.key, keyOwnerId: a.keyOwnerId, hits: 0, lastSeen: 0, games: [], alarms: [] };
      map.set(key, g);
    }
    g.hits += a.count;
    g.lastSeen = Math.max(g.lastSeen, a.lastSeen);
    g.keyOwnerId = g.keyOwnerId ?? a.keyOwnerId;
    g.alarms.push(a);
    let game = g.games.find((x) => x.gameId === a.gameId);
    if (!game) {
      game = { gameId: a.gameId, alarms: [] };
      g.games.push(game);
    }
    game.alarms.push(a);
  }
  return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

function parseDetail(detail: string | null): { discordId?: string; username?: string } {
  if (detail === null) return {};
  try {
    return JSON.parse(detail) as { discordId?: string; username?: string };
  } catch {
    return {};
  }
}
