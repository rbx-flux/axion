// The activity log with level filter, search, resolve and purge.

import { useState } from "react";
import { api, type Level, type LogEntry } from "../../api";
import { ActionMessage, Badge, Button, Empty, LevelBadge, Mono, Notice, Spinner, Time, confirmAction, useAction, useLoad } from "../../ui";

const LEVELS: (Level | "")[] = ["", "error", "warn", "info"];

export function Logs() {
  const [level, setLevel] = useState<Level | "">("");
  const [unresolved, setUnresolved] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { busy, message, setMessage, run } = useAction();

  const params = new URLSearchParams({ limit: "300" });
  if (level) params.set("level", level);
  if (unresolved) params.set("unresolved", "1");
  if (query) params.set("q", query);
  const { data, error, loading, reload } = useLoad(() => api.get<{ logs: LogEntry[] }>(`/api/admin/logs?${params}`), [level, unresolved, query]);
  const logs = data?.logs ?? [];

  function toggle(set: Set<number>, id: number, apply: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  const resolvable = logs.filter((l) => l.level !== "info" && l.resolvedAt === null);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Logs</h1>
          <p className="muted small">Info entries are dropped after 24 hours by the nightly job. Warnings and errors stay until resolved.</p>
        </div>
        <div className="actions">
          <Button icon="refresh" onClick={() => void reload()} busy={loading}>
            Refresh
          </Button>
          <Button icon="check" disabled={resolvable.length === 0} busy={busy} onClick={() => confirmAction("Resolve every unresolved warning and error?") && void run(async () => {
            const r = await api.post<{ resolved: number }>("/api/admin/logs/resolve", { all: true });
            await reload();
            return `Resolved ${r.resolved}.`;
          })}>
            Resolve all
          </Button>
          <Button variant="danger" icon="trash" busy={busy} onClick={() => confirmAction("Delete all info-level entries now?") && void run(async () => {
            const r = await api.post<{ deleted: number }>("/api/admin/logs/purge");
            await reload();
            return `Purged ${r.deleted} info entries.`;
          })}>
            Purge info
          </Button>
        </div>
      </header>

      <div className="filters">
        <div className="seg" role="group" aria-label="Level">
          {LEVELS.map((l) => (
            <button key={l} className={level === l ? "active" : ""} onClick={() => setLevel(l)} aria-pressed={level === l}>
              {l === "" ? "all" : l}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={unresolved} onChange={(e) => setUnresolved(e.target.checked)} /> unresolved only
        </label>
        <form
          className="searchbar grow"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message, event or actor" aria-label="Search logs" />
          <Button type="submit">Search</Button>
        </form>
      </div>

      <ActionMessage message={message} onClose={() => setMessage(null)} />
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}
      {data !== null && logs.length === 0 && <Empty>Nothing logged for this filter.</Empty>}

      {logs.length > 0 && (
        <div className="table-wrap card card-flush">
          <table className="table log-table">
            <thead>
              <tr>
                <th />
                <th>When</th>
                <th>Level</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Message</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className={l.resolvedAt !== null ? "dim-row" : ""}>
                  <td>
                    {l.level !== "info" && l.resolvedAt === null && (
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(selected, l.id, setSelected)} aria-label={`select log ${l.id}`} />
                    )}
                  </td>
                  <td className="nowrap">
                    <Time at={l.ts} exact />
                  </td>
                  <td>
                    <LevelBadge level={l.level} />
                  </td>
                  <td>
                    <Mono>{l.event}</Mono>
                  </td>
                  <td>{l.actor ? <Mono>{l.actor}</Mono> : <span className="muted">—</span>}</td>
                  <td>
                    {l.message}
                    {l.data !== null && l.data !== undefined && (
                      <>
                        {" "}
                        <button className="linkish" onClick={() => toggle(expanded, l.id, setExpanded)} aria-expanded={expanded.has(l.id)}>
                          {expanded.has(l.id) ? "hide data" : "data"}
                        </button>
                        {expanded.has(l.id) && <pre className="data">{JSON.stringify(l.data, null, 2)}</pre>}
                      </>
                    )}
                  </td>
                  <td className="nowrap">
                    {l.level === "info" ? (
                      <span className="muted small">—</span>
                    ) : l.resolvedAt === null ? (
                      <Badge tone="warn">open</Badge>
                    ) : (
                      <span className="muted small">
                        resolved <Time at={l.resolvedAt} /> by <Mono>{l.resolvedBy}</Mono>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.size > 0 && (
        <div className="action-bar" role="toolbar" aria-label="Selected log entries">
          <span>{selected.size} selected</span>
          <Button variant="primary" icon="check" busy={busy} onClick={() => void run(async () => {
            const r = await api.post<{ resolved: number }>("/api/admin/logs/resolve", { ids: [...selected] });
            setSelected(new Set());
            await reload();
            return `Resolved ${r.resolved}.`;
          })}>
            Resolve selected
          </Button>
          <Button onClick={() => setSelected(new Set())}>Deselect</Button>
        </div>
      )}
    </>
  );
}
