// Request/response plumbing shared by every route.

export type Input = Record<string, unknown>;

export function reply(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return reply(status, { ok: false, error, ...extra });
}

// Thrown by handlers to short-circuit with a client-facing error.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const now = (): number => Math.floor(Date.now() / 1000);

// Merges query parameters with a json body (body wins), so callers can use
// either `?creatorId=1` or `{"creatorId": 1}`. Throws on malformed json.
export async function readInput(request: Request): Promise<Input> {
  const input: Input = {};
  for (const [key, value] of new URL(request.url).searchParams) input[key] = value;

  const contentType = request.headers.get("content-type") ?? "";
  if (request.body !== null && contentType.includes("application/json")) {
    const text = await request.text();
    if (text.length > 0) {
      const decoded: unknown = JSON.parse(text);
      if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
        Object.assign(input, decoded);
      }
    }
  }
  return input;
}

// Roblox user/game ids are positive integers; accept them as numbers or strings.
export function parseId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function parseIdOrThrow(value: unknown, name: string): number {
  const id = parseId(value);
  if (id === null) throw new HttpError(400, `${name} must be a positive integer`);
  return id;
}

export function optionalId(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  return parseIdOrThrow(value, name);
}

export function parseString(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${name} must be a non-empty string`);
  }
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value.trim();
}

export function optionalString(value: unknown, max = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length === 0) return null;
  return s.slice(0, max);
}

export function parseBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  if (key.length === 0 || key.length > 64) return null;
  return key;
}

// Compares two strings without leaking how much of them matched.
export function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

export async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return toHex(new Uint8Array(sig));
}

// COOKIES --------------------------------------------------------------------

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { location, ...headers } });
}

// The origin the browser is talking to. Cloudflare terminates TLS, so the
// request URL already carries the right scheme in production and in dev.
export function origin(request: Request): string {
  return new URL(request.url).origin;
}
