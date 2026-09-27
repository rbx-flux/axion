import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api, type Overview } from "../../api";
import { Badge, Icon, Notice, Spinner, Time, useLoad, type IconName } from "../../ui";
import { Alarms } from "./Alarms";
import { Diagnostics } from "./Diagnostics";
import { Files } from "./Files";
import { Licenses } from "./Licenses";
import { Logs } from "./Logs";
import { Settings } from "./Settings";
import { Telemetry } from "./Telemetry";
import { Users } from "./Users";

// `moderator` tabs are open to moderators; the rest are admin-only.
const TABS: { to: string; label: string; icon: IconName; end?: boolean; moderator?: boolean }[] = [
  { to: "/admin", label: "Overview", icon: "dashboard", end: true },
  { to: "/admin/alarms", label: "Alarms", icon: "bell" },
  { to: "/admin/diagnostics", label: "Diagnostics", icon: "bug" },
  { to: "/admin/files", label: "Releases", icon: "upload" },
  { to: "/admin/licenses", label: "Licences", icon: "key", moderator: true },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/telemetry", label: "Telemetry", icon: "activity" },
  { to: "/admin/logs", label: "Logs", icon: "logs" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

export function Admin({ admin }: { admin: boolean }) {
  if (!admin) return <ModeratorArea />;
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin sections">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-body">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="alarms" element={<Alarms />} />
          <Route path="diagnostics" element={<Diagnostics />} />
          <Route path="files" element={<Files />} />
          <Route path="licenses" element={<Licenses admin />} />
          <Route path="users" element={<Users />} />
          <Route path="telemetry" element={<Telemetry />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Notice tone="warn">No such admin page.</Notice>} />
        </Routes>
      </div>
    </div>
  );
}

// Moderators get the Licences page (grant, revoke, rotate, testers) and
// nothing else; the API refuses the admin-only routes regardless.
function ModeratorArea() {
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Moderation sections">
        {TABS.filter((t) => t.moderator).map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-body">
        <Routes>
          <Route index element={<Navigate to="/admin/licenses" replace />} />
          <Route path="licenses" element={<Licenses admin={false} />} />
          <Route path="*" element={<Notice tone="warn">This page is for admins only.</Notice>} />
        </Routes>
      </div>
    </div>
  );
}

function OverviewPage() {
  const { data, error, loading } = useLoad(() => api.get<Overview>("/api/admin/overview"));
  if (loading && data === null) return <Spinner />;
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (data === null) return null;

  const alarmRows = Object.values(data.alarms).reduce((n, a) => n + Number(a.rows), 0);
  const alarmHits = Object.values(data.alarms).reduce((n, a) => n + Number(a.hits), 0);
  const openLogs = Object.values(data.logs).reduce((n, l) => n + Number(l.rows), 0);

  return (
    <>
      <header className="admin-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Overview</h1>
        </div>
        <p className="muted small">
          as of <Time at={data.now} exact />
        </p>
      </header>

      <div className="stats">
        <Stat to="/admin/alarms" label="Open alarms" value={alarmRows} tone={alarmRows > 0 ? (data.alarms.error ? "bad" : "warn") : "ok"} sub={`${alarmHits} hits collapsed`} />
        <Stat to="/admin/diagnostics" label="Open diagnostics" value={data.diagnostics.open} tone={data.diagnostics.open > 0 ? "bad" : "ok"} sub={data.diagnostics.open > 0 ? `from ${data.diagnostics.users} game owner(s)` : "no reports waiting"} />
        <Stat to="/admin/logs" label="Unresolved logs" value={openLogs} tone={openLogs > 0 ? "warn" : "ok"} sub={Object.entries(data.logs).map(([l, v]) => `${v.rows} ${l}`).join(" · ") || "all quiet"} />
        <Stat to="/admin/licenses" label="Licences" value={data.licenses.n} sub={`${data.licenses.keyed ?? 0} with a key · ${data.licenses.testers ?? 0} tester(s)`} />
        <Stat to="/admin/users" label="Signed-in users" value={data.users.n} sub={`${data.users.linked ?? 0} linked to Roblox`} />
        <Stat to="/admin/telemetry" label="Pings, 24 h" value={data.telemetry24h.n} sub={`${data.telemetry24h.users} users · ${data.telemetry24h.games} games`} />
        <Stat to="/admin/files" label="Releases" value={data.files.n} sub={`${data.files.published ?? 0} published`} />
      </div>
    </>
  );
}

function Stat({ to, label, value, sub, tone }: { to: string; label: string; value: number; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <NavLink to={to} className="stat">
      <span className="stat-label">
        {label} {tone && <Badge tone={tone}>{tone === "ok" ? "clear" : tone === "warn" ? "attention" : "critical"}</Badge>}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </NavLink>
  );
}
