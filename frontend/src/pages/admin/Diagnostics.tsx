// Diagnostics: reports sent from the OrbitDebug popup when a game hits a
// critical failure (licence server, DataStore, an extension that failed to
// load, ...). Expand a report for its failures, the build's context, Orbit's
// log and the server's whole console output; Download JSON saves all of it.

import { Fragment, useState, type ReactNode } from "react";
import { api, type DiagnosticReport, type DiagnosticReportDetail, type Level } from "../../api";
import { ActionMessage, Badge, Button, Empty, LevelBadge, Mono, Notice, Spinner, Time, confirmAction, useAction, useLoad } from "../../ui";

// Mirrors CODES in Orbit's Modules.diagnostics.
const CODES: Record<number, string> = {
  101: "License server unreachable",
  102: "DataStore failure",
  103: "Extension failed to load",
  104: "Extension crashed on start",
  105: "Authentication failed to start",
  106: "Core script error",
  107: "MessagingService failure",
  108: "MemoryStore failure",
  109: "License invalid",
};

export function Diagnostics() {
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { busy, message, setMessage, run } = useAction();

  const params = new URLSearchParams({ limit: "300" });
  if (open) params.set("unresolved", "1");
  if (code) params.set("code", code);
  if (query) params.set("q", query);
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ reports: DiagnosticReport[] }>(`/api/admin/diagnostics?${params}`),
    [open, code, query],
  );
  const reports = data?.reports ?? [];

  function toggle(set: Set<number>, id: number, apply: (s: Set<number>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  async function resolve(body: { ids: number[] } | { all: true }) {
    const r = await api.post<{ resolved: number }>("/api/admin/diagnostics/resolve", body);
    setSelected(new Set());
    await reload();
    return `Resolved ${r.resolved}.`;
  }

  const unresolved = reports.filter((r) => r.resolvedAt === null);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Diagnostics</h1>
          <p className="muted small">
            Sent from a game when staff press “Send Diagnostics” on the Orbit error popup. Resolved reports are dropped after the telemetry retention window.
          </p>
        </div>
        <div className="actions">
          <Button icon="refresh" onClick={() => void reload()} busy={loading}>
            Refresh
          </Button>
          <Button icon="check" disabled={unresolved.length === 0} busy={busy} onClick={() => confirmAction("Resolve every open report?") && void run(() => resolve({ all: true }))}>
            Resolve all
          </Button>
        </div>
      </header>

      <div className="filters">
        <div className="seg" role="group" aria-label="State">
          <button className={open ? "active" : ""} onClick={() => setOpen(true)} aria-pressed={open}>
            open
          </button>
          <button className={!open ? "active" : ""} onClick={() => setOpen(false)} aria-pressed={!open}>
            all
          </button>
        </div>
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Filter by error code">
          <option value="">every code</option>
          {Object.entries(CODES).map(([c, title]) => (
            <option key={c} value={c}>
              {c} · {title}
            </option>
          ))}
        </select>
        <form
          className="searchbar grow"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summary, job id or version" aria-label="Search reports" />
          <Button type="submit">Search</Button>
        </form>
      </div>

      <ActionMessage message={message} onClose={() => setMessage(null)} />
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && data === null && <Spinner />}
      {data !== null && reports.length === 0 && <Empty>{open ? "No open reports. Every game is behaving." : "No reports for this filter."}</Empty>}

      {reports.length > 0 && (
        <div className="table-wrap card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>When</th>
                <th>Game</th>
                <th>Owner</th>
                <th>Codes</th>
                <th>First failure</th>
                <th>Version</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <Fragment key={r.id}>
                  <tr className={r.resolvedAt !== null ? "dim-row" : ""}>
                    <td>
                      {r.resolvedAt === null && (
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(selected, r.id, setSelected)} aria-label={`select report ${r.id}`} />
                      )}
                    </td>
                    <td className="nowrap">
                      <Time at={r.ts} />
                      <div className="muted small">#{r.id}</div>
                    </td>
                    <td className="nowrap">
                      {r.placeId !== null ? (
                        <a href={`https://www.roblox.com/games/${r.placeId}`} target="_blank" rel="noreferrer">
                          <Mono>{r.gameId ?? r.placeId}</Mono>
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.studio && (
                        <>
                          {" "}
                          <Badge tone="info">studio</Badge>
                        </>
                      )}
                    </td>
                    <td className="nowrap">
                      <Mono>{r.creatorId}</Mono>{" "}
                      {!r.licensed ? <Badge tone="bad">unlicensed</Badge> : r.keyValid === false ? <Badge tone="bad">bad key</Badge> : null}
                    </td>
                    <td>
                      <span className="badges">
                        {r.codes.map((c) => (
                          <span key={c} title={CODES[c] ?? "Unknown failure"}>
                            <Badge tone="bad">{c}</Badge>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="diag-summary">{r.summary}</span>{" "}
                      <button className="linkish" onClick={() => toggle(expanded, r.id, setExpanded)} aria-expanded={expanded.has(r.id)}>
                        {expanded.has(r.id) ? "hide" : "details"}
                      </button>
                    </td>
                    <td className="nowrap">{r.version ? <Mono>{r.version}</Mono> : <span className="muted">—</span>}</td>
                    <td className="nowrap">
                      {r.resolvedAt === null ? (
                        <Badge tone="warn">open</Badge>
                      ) : (
                        <span className="muted small">
                          resolved <Time at={r.resolvedAt} /> by <Mono>{r.resolvedBy}</Mono>
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr className="detail-row">
                      <td colSpan={8}>
                        <ReportDetail id={r.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.size > 0 && (
        <div className="action-bar" role="toolbar" aria-label="Selected reports">
          <span>{selected.size} selected</span>
          <Button variant="primary" icon="check" busy={busy} onClick={() => void run(() => resolve({ ids: [...selected] }))}>
            Resolve selected
          </Button>
          <Button onClick={() => setSelected(new Set())}>Deselect</Button>
        </div>
      )}
    </>
  );
}

function ReportDetail({ id }: { id: number }) {
  const [source, setSource] = useState<"log" | "console">("log");
  const [filter, setFilter] = useState("");
  const { data, error, loading } = useLoad(() => api.get<{ report: DiagnosticReportDetail }>(`/api/admin/diagnostics/${id}`), [id]);
  if (loading && data === null) return <Spinner />;
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (data === null) return null;
  const r = data.report;
  const p = r.payload;
  const c = p?.context ?? null;

  const needle = filter.trim().toLowerCase();
  const lines: { at: number | null; level: Level; text: string }[] =
    source === "log"
      ? (p?.log ?? [])
      : (p?.console ?? []).map((l) => ({ at: l.at, level: l.type === "output" ? "info" : l.type, text: l.text }));
  const shown = needle ? lines.filter((l) => l.text.toLowerCase().includes(needle)) : lines;

  function download() {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orbit-diagnostics-${r.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="diag-detail">
      <div className="diag-detail-head">
        <h3 className="small-h">Report #{r.id}</h3>
        <Button icon="download" onClick={download}>
          Download JSON
        </Button>
      </div>

      <dl className="facts">
        <Fact label="Server">{r.jobId ? <Mono>{r.jobId}</Mono> : <span className="muted">Studio / none</span>}</Fact>
        <Fact label="Place">{r.placeId !== null ? <Mono>{`${r.placeId}${c?.placeVersion !== undefined ? ` v${c.placeVersion}` : ""}`}</Mono> : null}</Fact>
        <Fact label="Sent by">{r.reporterId !== null ? <Mono>{r.reporterId}</Mono> : null}</Fact>
        <Fact label="Key">
          {r.key ? <Mono>{r.key}</Mono> : <span className="muted">none sent</span>}{" "}
          {r.keyValid === true && <Badge tone="ok">valid</Badge>}
          {r.keyValid === false && <Badge tone="bad">not theirs</Badge>}
        </Fact>
        <Fact label="Orbit / Roblox">{c ? <Mono>{`${c.orbitVersion ?? "?"} / ${c.robloxVersion ?? "?"}`}</Mono> : null}</Fact>
        <Fact label="Uptime">
          {p?.uptime != null ? `Orbit ${formatDuration(p.uptime)}${c?.serverAge !== undefined ? ` · server ${formatDuration(c.serverAge)}` : ""}` : null}
        </Fact>
        <Fact label="Players">
          {c?.players !== undefined ? `${c.players} / ${c.maxPlayers ?? "?"}${c.privateServer ? " · private server" : ""}` : (p?.players ?? null)}
        </Fact>
        <Fact label="Owner">
          <Mono>{c ? `${c.ownerId ?? r.creatorId}${c.creatorType === "Group" ? ` (group ${c.creatorId})` : ""}` : String(r.creatorId)}</Mono>
        </Fact>
        <Fact label="Auth">
          {c ? c.authReady === false ? <Badge tone="warn">not started</Badge> : c.authHealthy ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">failed</Badge> : null}
        </Fact>
        <Fact label="HTTP">{c?.httpEnabled === undefined ? null : c.httpEnabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="bad">disabled</Badge>}</Fact>
        <Fact label="Memory">{c?.memoryMb !== undefined ? `${c.memoryMb} MB` : null}</Fact>
        <Fact label="Heartbeat">{c?.heartbeatMs !== undefined ? `${c.heartbeatMs} ms` : null}</Fact>
      </dl>

      {c?.extensions && c.extensions.length > 0 && (
        <div className="diag-chips" aria-label="Extensions">
          <span className="muted small">Extensions</span>
          {c.extensions.map((e) => (
            <span key={e.name} className="diag-chip">
              <Mono>{e.name}</Mono>{" "}
              <Badge tone={e.status === "running" || e.status === "client only" ? "ok" : e.status === "starting" ? "warn" : "bad"}>{e.status}</Badge>
            </span>
          ))}
        </div>
      )}
      {c?.probes && c.probes.length > 0 && (
        <div className="diag-chips" aria-label="Service probes">
          <span className="muted small">Probes</span>
          {c.probes.map((pr) => (
            <span key={pr.service} className="diag-chip" title={pr.lastError ?? undefined}>
              <Mono>{pr.service}</Mono> {pr.failures > 0 ? <Badge tone="bad">{`${pr.failures} failed`}</Badge> : <Badge tone="ok">ok</Badge>}
            </span>
          ))}
        </div>
      )}

      <h3 className="small-h">Open failures</h3>
      {p === null || p.incidents.length === 0 ? (
        <Empty>No failures in this report.</Empty>
      ) : (
        <ul className="diag-incidents">
          {p.incidents.map((i, n) => (
            <li key={n}>
              <div className="diag-incident-head">
                <Badge tone="bad">{i.code}</Badge>
                <strong>{i.title}</strong>
                {i.source && <Mono>{i.source}</Mono>}
                {i.count > 1 && <span className="muted small">×{i.count}</span>}
                <span className="muted small">
                  {i.firstAt !== null && <>first <Time at={i.firstAt} exact /></>}
                  {i.lastAt !== null && i.lastAt !== i.firstAt && <> · last <Time at={i.lastAt} exact /></>}
                </span>
              </div>
              {i.detail && <pre className="data">{i.detail}</pre>}
            </li>
          ))}
        </ul>
      )}

      <div className="diag-log-head">
        <div className="seg" role="group" aria-label="Which log">
          <button className={source === "log" ? "active" : ""} onClick={() => setSource("log")} aria-pressed={source === "log"}>
            Orbit log · {p?.log.length ?? 0}
          </button>
          <button className={source === "console" ? "active" : ""} onClick={() => setSource("console")} aria-pressed={source === "console"}>
            Server output · {p?.console?.length ?? 0}
          </button>
        </div>
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter lines" aria-label="Filter log lines" />
      </div>
      {shown.length === 0 ? (
        <Empty>{lines.length === 0 ? (source === "console" ? "This build didn't send its server output." : "No log lines were sent.") : "No lines match."}</Empty>
      ) : (
        <ol className="console" aria-label={source === "log" ? "Orbit log" : "Server output"}>
          {shown.map((line, n) => (
            <li key={n} className={`console-${line.level}`}>
              <span className="console-time">{line.at !== null ? clockTime(line.at) : ""}</span>
              <LevelBadge level={line.level} />
              <span className="console-text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// A fact row that shows a dash when there is nothing to say.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "" || children === false;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{empty ? <span className="muted">—</span> : children}</dd>
    </div>
  );
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function clockTime(seconds: number): string {
  return clock.format(new Date(seconds * 1000));
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
