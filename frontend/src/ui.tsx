// Small shared pieces: the mark, icons, timestamps, buttons, notices.

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { FaDiscord } from "react-icons/fa6";
import {
  LuActivity,
  LuBell,
  LuBook,
  LuBug,
  LuCheck,
  LuDownload,
  LuExternalLink,
  LuFlaskConical,
  LuInfo,
  LuKey,
  LuLayoutDashboard,
  LuLock,
  LuLogOut,
  LuMenu,
  LuRadio,
  LuRefreshCw,
  LuScrollText,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuTrash2,
  LuTriangleAlert,
  LuUpload,
  LuUser,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { errorMessage } from "./api";

// The Orbit mark: the studio's logo, white on transparent.
export function Mark({ size = 24 }: { size?: number }) {
  return <img className="mark" src="/logo.png" width={size} height={size} alt="" aria-hidden="true" />;
}

// Lucide via react-icons, plus the Discord brand mark.
const ICONS = {
  discord: FaDiscord,
  download: LuDownload,
  external: LuExternalLink,
  book: LuBook,
  shield: LuShield,
  alert: LuTriangleAlert,
  check: LuCheck,
  x: LuX,
  refresh: LuRefreshCw,
  key: LuKey,
  trash: LuTrash2,
  upload: LuUpload,
  user: LuUser,
  users: LuUsers,
  lock: LuLock,
  radio: LuRadio,
  activity: LuActivity,
  menu: LuMenu,
  bell: LuBell,
  cart: LuShoppingCart,
  logs: LuScrollText,
  settings: LuSettings,
  dashboard: LuLayoutDashboard,
  logout: LuLogOut,
  info: LuInfo,
  flask: LuFlaskConical,
  bug: LuBug,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Component = ICONS[name];
  return <Component className="icon" size={size} aria-hidden="true" />;
}

// TIME -----------------------------------------------------------------------

const absolute = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export function formatTime(seconds: number): string {
  return absolute.format(new Date(seconds * 1000));
}

export function relativeTime(seconds: number, nowSeconds = Date.now() / 1000): string {
  const delta = Math.round(nowSeconds - seconds);
  const abs = Math.abs(delta);
  const suffix = delta >= 0 ? "ago" : "from now";
  if (abs < 45) return delta >= 0 ? "just now" : "in a moment";
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)} h ${suffix}`;
  if (abs < 86400 * 30) return `${Math.round(abs / 86400)} d ${suffix}`;
  return absolute.format(new Date(seconds * 1000));
}

// Unix seconds → "2 h ago" with the exact time on hover and in the DOM.
export function Time({ at, exact = false }: { at: number | null | undefined; exact?: boolean }) {
  if (at === null || at === undefined) return <span className="muted">—</span>;
  const iso = new Date(at * 1000).toISOString();
  return (
    <time dateTime={iso} title={`${formatTime(at)} · ${iso}`} className="time">
      {exact ? formatTime(at) : relativeTime(at)}
    </time>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// CONTROLS -------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  icon?: IconName;
  busy?: boolean;
};

export function Button({ variant = "ghost", icon, busy = false, children, className = "", disabled, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function LevelBadge({ level }: { level: "info" | "warn" | "error" }) {
  const tone = level === "error" ? "bad" : level === "warn" ? "warn" : "info";
  return <Badge tone={tone}>{level}</Badge>;
}

export function Notice({ tone = "info", children, onClose }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <Icon name={tone === "ok" ? "check" : tone === "info" ? "info" : "alert"} />
      <div className="notice-body">{children}</div>
      {onClose && (
        <button className="notice-close" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}…
    </p>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <code className={`mono ${className}`}>{children}</code>;
}

// Copies text; flips its label briefly so the click is acknowledged.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      icon={done ? "check" : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

// DATA LOADING ---------------------------------------------------------------

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

// Runs `load` on mount (and whenever `deps` change); the pages call `reload`
// after a mutation.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

// A one-shot action with busy state and an outcome message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const run = useCallback(async (fn: () => Promise<string | void>, okText?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const out = await fn();
      const text = typeof out === "string" ? out : okText;
      if (text) setMessage({ tone: "ok", text });
    } catch (e) {
      setMessage({ tone: "bad", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, setMessage, run };
}

export function ActionMessage({ message, onClose }: { message: { tone: "ok" | "bad" | "info"; text: string } | null; onClose: () => void }) {
  if (message === null) return null;
  return (
    <Notice tone={message.tone} onClose={onClose}>
      {message.text}
    </Notice>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function confirmAction(text: string): boolean {
  return window.confirm(text);
}
