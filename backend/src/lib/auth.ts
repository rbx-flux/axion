// Discord sign-in and browser sessions.
//
// Sign-in is Discord OAuth2 with the `identify` scope. The Worker never sees
// a password; it swaps the code Discord hands back for the user's id and
// name, then issues its own session (a random id in an HttpOnly cookie,
// looked up in the sessions table). Admins and moderators are fixed lists of
// Discord ids.

import { findSessionUser, type UserRow } from "./db";
import { HttpError, cookie, hmac, now, randomToken, readCookie } from "./http";

export const SESSION_COOKIE = "axion_session";
const STATE_COOKIE = "axion_oauth";
const STATE_TTL = 600;

// Discord user ids allowed into /admin.
export const ADMIN_DISCORD_IDS: ReadonlySet<string> = new Set([
  "654662261016756254",
  "1040734746625450014",
]);

// Discord user ids allowed to manage licences and product testers (grant,
// revoke, rotate keys, appoint/remove testers) but nothing else in /admin.
export const MODERATOR_DISCORD_IDS: ReadonlySet<string> = new Set([
  "1193285201783181361",
]);

export function isAdmin(user: UserRow | null): boolean {
  return user !== null && ADMIN_DISCORD_IDS.has(user.discord_id);
}

// Moderator-level access: moderators, and admins (who can do everything).
export function isModerator(user: UserRow | null): boolean {
  return user !== null && (MODERATOR_DISCORD_IDS.has(user.discord_id) || isAdmin(user));
}

export async function currentUser(request: Request, env: Env): Promise<UserRow | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (id === null || !/^[0-9a-f]{64}$/.test(id)) return null;
  return findSessionUser(env.DB, id);
}

export function sessionCookie(request: Request, id: string, ttl: number): string {
  return cookie(request, SESSION_COOKIE, id, ttl);
}

export function clearSessionCookie(request: Request): string {
  return cookie(request, SESSION_COOKIE, "", 0);
}

// OAUTH STATE ----------------------------------------------------------------
//
// The state parameter carries a nonce, an expiry and where to send the user
// afterwards, signed with SESSION_SECRET so the callback can trust it. It is
// also stored in a short-lived cookie so a stolen link cannot complete
// someone else's sign-in.

export async function makeState(
  request: Request,
  env: Env,
  returnTo: string,
): Promise<{ state: string; cookie: string }> {
  const payload = `${randomToken(16)}.${now() + STATE_TTL}.${encodeURIComponent(returnTo)}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  const state = `${payload}.${sig}`;
  return { state, cookie: cookie(request, STATE_COOKIE, state, STATE_TTL) };
}

export async function checkState(
  request: Request,
  env: Env,
  state: string | null,
): Promise<{ returnTo: string; clearCookie: string }> {
  const clearCookie = cookie(request, STATE_COOKIE, "", 0);
  if (state === null || readCookie(request, STATE_COOKIE) !== state) {
    throw new HttpError(400, "sign-in state did not match; please try again");
  }
  const parts = state.split(".");
  if (parts.length !== 4) throw new HttpError(400, "malformed sign-in state");
  const [nonce, expires, returnTo, sig] = parts;
  const expected = await hmac(env.SESSION_SECRET, `${nonce}.${expires}.${returnTo}`);
  if (expected !== sig) throw new HttpError(400, "sign-in state was tampered with");
  if (Number(expires) < now()) throw new HttpError(400, "sign-in took too long; please try again");
  return { returnTo: safeReturnTo(decodeURIComponent(returnTo)), clearCookie };
}

// Only same-origin paths; never an absolute URL somebody could redirect to.
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/account";
  return value;
}

// DISCORD --------------------------------------------------------------------

const DISCORD_API = "https://discord.com/api/v10";

// Names what is missing or too short, or null when sign-in can run.
export function discordConfigProblem(env: Env): string | null {
  if (typeof env.DISCORD_CLIENT_ID !== "string" || env.DISCORD_CLIENT_ID.length === 0) return "DISCORD_CLIENT_ID is not set";
  if (typeof env.DISCORD_CLIENT_SECRET !== "string" || env.DISCORD_CLIENT_SECRET.length === 0) return "DISCORD_CLIENT_SECRET is not set";
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 16) return "SESSION_SECRET must be at least 16 characters";
  return null;
}

export function discordConfigured(env: Env): boolean {
  return discordConfigProblem(env) === null;
}

export function discordRedirectUri(origin: string): string {
  return `${origin}/api/auth/discord/callback`;
}

export function discordAuthorizeUrl(env: Env, origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: discordRedirectUri(origin),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

// Exchanges the callback code for the signed-in user's profile.
export async function fetchDiscordUser(env: Env, origin: string, code: string): Promise<DiscordUser> {
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: discordRedirectUri(origin),
    }),
  });
  if (!tokenResponse.ok) {
    throw new HttpError(502, `Discord rejected the sign-in (HTTP ${tokenResponse.status})`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (typeof token.access_token !== "string") throw new HttpError(502, "Discord returned no token");

  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) {
    throw new HttpError(502, `Discord did not return the profile (HTTP ${userResponse.status})`);
  }
  const user = (await userResponse.json()) as DiscordUser;
  if (typeof user.id !== "string" || typeof user.username !== "string") {
    throw new HttpError(502, "Discord returned an unexpected profile");
  }
  return user;
}

export function discordAvatarUrl(user: { discord_id: string; discord_avatar: string | null }): string | null {
  if (user.discord_avatar === null) return null;
  const ext = user.discord_avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.discord_avatar}.${ext}?size=64`;
}
