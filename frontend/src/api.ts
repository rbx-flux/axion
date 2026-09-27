// The Worker's JSON API, typed. Every call resolves to the parsed body or
// throws an ApiError carrying the server's message.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (form !== undefined) init.body = form;
  else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data: { ok?: boolean; error?: string } & T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, response.ok ? "unexpected response" : `HTTP ${response.status}`);
  }
  if (!response.ok || data.ok === false) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`);
  return data;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => call<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => call<T>("DELETE", path, body),
  upload: <T>(path: string, form: FormData) => call<T>("POST", path, undefined, form),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

// TYPES ----------------------------------------------------------------------

export interface User {
  discordId: string;
  username: string;
  avatar: string | null;
  robloxId: number | null;
  robloxUsername: string | null;
  bloxlinkCheckedAt: number | null;
  bloxlinkError: string | null;
  parcelCheckedAt: number | null;
  createdAt: number;
  lastLoginAt: number;
  admin: boolean;
  // Admins are moderators too; moderators only manage licences and testers.
  moderator: boolean;
}

export interface License {
  creatorId: number;
  licensedAt: number;
  source: string;
  hasKey: boolean;
  keyIssuedAt: number | null;
  tester: boolean;
  testerSince: number | null;
}

// release: production, for every licensee. tester: product testers only.
export type Channel = "release" | "tester";

export interface Release {
  id: string;
  name: string;
  version: string | null;
  notes: string | null;
  size: number;
  published: boolean;
  channel: Channel;
  markerHits: number;
  uploadedAt: number;
  uploadedBy: string;
  builds?: number;
}

export interface Me {
  user: User | null;
  license?: License | null;
  files?: Release[];
  parcelEnabled?: boolean;
  bloxlinkConfigured?: boolean;
  discordConfigured: boolean;
  discordProblem?: string | null;
}

export type Level = "info" | "warn" | "error";

export interface Alarm {
  id: number;
  kind: "key_mismatch" | "unknown_key" | "unlicensed" | "deletion_request";
  level: Level;
  creatorId: number | null;
  key: string | null;
  keyOwnerId: number | null;
  gameId: number | null;
  detail: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  clearedAt: number | null;
  clearedBy: string | null;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: Level;
  event: string;
  actor: string | null;
  message: string;
  data: unknown;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface AdminLicense extends License {
  key: string | null;
  issuedBy: string | null;
  testerBy: string | null;
  discordId: string | null;
  discordUsername: string | null;
  robloxUsername: string | null;
}

export interface TelemetryPing {
  id: number;
  ts: number;
  creatorId: number;
  key: string | null;
  gameId: number | null;
  version: string | null;
  licensed: boolean;
  keyValid: boolean | null;
}

export interface GameSummary {
  game_id: number | null;
  pings: number;
  users: number;
  last_seen: number;
  unlicensed: number;
  bad_keys: number;
  version: string | null;
}

export interface AdminUser extends User {
  licensed: boolean;
}

export interface Settings {
  bloxlink_guild_id: string;
  bloxlink_api_key: string;
  parcel_enabled: string;
  parcel_hub_id: string;
  parcel_product_id: string;
  nyxyl_api_key: string;
  obfuscate_mode: string;
  obfuscate_scope: string;
  key_marker: string;
  telemetry_retention_days: string;
  _secrets: string[];
}

// A report sent from the OrbitDebug popup in a running game.
export interface DiagnosticIncident {
  code: number;
  title: string;
  detail: string;
  source: string | null;
  count: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface DiagnosticLogLine {
  at: number | null;
  level: Level;
  text: string;
}

export interface DiagnosticConsoleLine {
  at: number | null;
  type: "output" | "info" | "warn" | "error";
  text: string;
}

// Snapshot the build sends with a report. Everything is optional: older
// builds send less, and it is stored as sent.
export interface DiagnosticContext {
  orbitVersion?: string;
  robloxVersion?: string;
  placeId?: number;
  placeVersion?: number;
  gameId?: number;
  jobId?: string;
  privateServer?: boolean;
  studio?: boolean;
  creatorType?: string;
  creatorId?: number;
  ownerId?: number;
  orbitUptime?: number;
  serverAge?: number;
  players?: number;
  maxPlayers?: number;
  httpEnabled?: boolean;
  authReady?: boolean;
  authHealthy?: boolean;
  memoryMb?: number;
  heartbeatMs?: number;
  extensions?: { name: string; status: string }[];
  probes?: { service: string; failures: number; lastError?: string | null; lastRun?: number | null }[];
  truncated?: boolean;
}

export interface DiagnosticReport {
  id: number;
  ts: number;
  creatorId: number;
  licensed: boolean;
  keyValid: boolean | null;
  gameId: number | null;
  placeId: number | null;
  jobId: string | null;
  version: string | null;
  studio: boolean;
  reporterId: number | null;
  codes: number[];
  summary: string;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

export interface DiagnosticReportDetail extends DiagnosticReport {
  key: string | null;
  payload: {
    incidents: DiagnosticIncident[];
    log: DiagnosticLogLine[];
    console?: DiagnosticConsoleLine[];
    context?: DiagnosticContext | null;
    uptime: number | null;
    players: number | null;
  } | null;
}

export interface Overview {
  now: number;
  licenses: { n: number; keyed: number | null; testers: number | null };
  users: { n: number; linked: number | null };
  alarms: Record<string, { rows: number; hits: number }>;
  logs: Record<string, { rows: number }>;
  telemetry24h: { n: number; users: number; games: number };
  files: { n: number; published: number | null };
  diagnostics: { open: number; users: number };
}
