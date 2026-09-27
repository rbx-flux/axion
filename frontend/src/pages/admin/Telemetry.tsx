// Telemetry: which games run Orbit (last 7 days) and the latest pings.

import { useState } from "react";
import { api, type GameSummary, type TelemetryPing } from "../../api";
import { Badge, Button, Empty, Mono, Notice, Spinner, Time, useLoad } from "../../ui";

export function Telemetry() {
  const [creatorId, setCreatorId] = useState("");
  const [gameId, setGameId] = useState("");
  const [filter, setFilter] = useState({ creatorId: "", gameId: "" });

  const params = new URLSearchParams({ limit: "300" });
  if (filter.creatorId) params.set("creatorId", filter.creatorId);
  if (filter.gameId) params.set("gameId", filter.gameId);
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ recent: TelemetryPing[]; games: GameSummary[] }>(`/api/admin/telemetry?${params}`),
    [filter],
  );

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Telemetry</h1>
          <p className="muted small">Builds report their game-owner id, key, universe id and version. Rows older than the retention window (Settings) are dropped nightly.</p>
        </div>
        <Button icon="refresh" onClick={() => void reload()} busy={loading}>
          Refresh
        </Button>
      </header>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ creatorId: creatorId.trim(), gameId: gameId.trim() });
        }}
      >
        <input inputMode="numeric" value={creatorId} onChange={(e) => setCreatorId(e.target.value)} placeholder="Roblox user id" aria-label="Filter by user" />
        <input inputMode="numeric" value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="Game (universe) id" aria-label="Filter by game" />
        <Button type="submit">Filter</Button>
        {(filter.creatorId || filter.gameId) && (
          <Button
            onClick={() => {
              setCreatorId("");
              setGameId("");
              setFilter({ creatorId: "", gameId: "" });
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}

      {data && (
        <>
          <section className="card card-flush" aria-labelledby="games-h">
            <h2 id="games-h" className="card-title">
              Games, last 7 days
            </h2>
            {data.games.length === 0 ? (
              <Empty>No pings in the last week.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Game</th>
                      <th className="num">Pings</th>
                      <th className="num">Users</th>
                      <th className="num">Unlicensed</th>
                      <th className="num">Bad keys</th>
                      <th>Version</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map((g) => (
                      <tr key={g.game_id ?? "none"}>
                        <td>
                          {g.game_id === null ? (
                            <span className="muted">no game id</span>
                          ) : (
                            <a href={`https://www.roblox.com/games/${g.game_id}`} target="_blank" rel="noreferrer">
                              <Mono>{g.game_id}</Mono>
                            </a>
                          )}
                        </td>
                        <td className="num">{g.pings}</td>
                        <td className="num">{g.users}</td>
                        <td className="num">{Number(g.unlicensed) > 0 ? <Badge tone="warn">{g.unlicensed}</Badge> : 0}</td>
                        <td className="num">{Number(g.bad_keys) > 0 ? <Badge tone="bad">{g.bad_keys}</Badge> : 0}</td>
                        <td>{g.version ? <Mono>{g.version}</Mono> : <span className="muted">—</span>}</td>
                        <td>
                          <Time at={g.last_seen} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card card-flush" aria-labelledby="recent-h">
            <h2 id="recent-h" className="card-title">
              Recent pings
            </h2>
            {data.recent.length === 0 ? (
              <Empty>Nothing matches.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Game</th>
                      <th>Version</th>
                      <th>Key</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">
                          <Time at={p.ts} exact />
                        </td>
                        <td>
                          <Mono>{p.creatorId}</Mono>
                        </td>
                        <td>{p.gameId === null ? <span className="muted">—</span> : <Mono>{p.gameId}</Mono>}</td>
                        <td>{p.version ? <Mono>{p.version}</Mono> : <span className="muted">—</span>}</td>
                        <td>{p.key ? <Mono>{p.key.slice(0, 11)}…</Mono> : <span className="muted">none</span>}</td>
                        <td>
                          {!p.licensed ? <Badge tone="warn">unlicensed</Badge> : p.keyValid === false ? <Badge tone="bad">bad key</Badge> : p.keyValid === null ? <Badge>no key sent</Badge> : <Badge tone="ok">ok</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
