// The three outside services: Bloxlink (Discord → Roblox), Parcel (did they
// buy it there?) and nyxyl's Umbra obfuscator. Each is a thin, typed fetch.

import type { Settings } from "./db";
import { HttpError } from "./http";

// BLOXLINK -------------------------------------------------------------------
//
// GET https://api.blox.link/v4/public/guilds/{guild}/discord-to-roblox/{user}
// with the server API key in `Authorization`. Only works for members of that
// guild who have verified with Bloxlink. Results are cached in `users`
// indefinitely; this is only called on first sign-in and on "re-verify".

export interface BloxlinkResult {
  robloxId: number | null;
  robloxUsername: string | null;
  // Human-readable reason when robloxId is null.
  error: string | null;
}

export async function bloxlinkLookup(settings: Settings, discordId: string): Promise<BloxlinkResult> {
  if (settings.bloxlink_guild_id === "" || settings.bloxlink_api_key === "") {
    return { robloxId: null, robloxUsername: null, error: "Bloxlink is not configured yet" };
  }
  const url = `https://api.blox.link/v4/public/guilds/${encodeURIComponent(settings.bloxlink_guild_id)}/discord-to-roblox/${encodeURIComponent(discordId)}`;
  const response = await fetch(url, { headers: { authorization: settings.bloxlink_api_key } });
  const body = (await response.json().catch(() => ({}))) as {
    robloxID?: string | number;
    error?: string;
    resolved?: { roblox?: { name?: string } };
  };
  if (!response.ok) {
    const reason =
      typeof body.error === "string" ? body.error : `Bloxlink returned HTTP ${response.status}`;
    // 404 is the normal "not linked / not in the server" answer.
    return { robloxId: null, robloxUsername: null, error: reason };
  }
  const robloxId = Number(body.robloxID);
  if (!Number.isSafeInteger(robloxId) || robloxId <= 0) {
    return { robloxId: null, robloxUsername: null, error: "Bloxlink returned no Roblox account" };
  }
  return {
    robloxId,
    robloxUsername: body.resolved?.roblox?.name ?? null,
    error: null,
  };
}

// ROBLOX ---------------------------------------------------------------------
//
// Public users API, used only to show a username next to an id.

export async function robloxUsername(robloxId: number): Promise<string | null> {
  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${robloxId}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { name?: string };
    return typeof body.name === "string" ? body.name : null;
  } catch {
    return null;
  }
}

// PARCEL ---------------------------------------------------------------------
//
// The v1 whitelist check the Parcel Roblox SDK uses. No secret; hub and
// product ids identify the product. Responds
//   200 { status, message, details: { owned: boolean } }
//   400/404 when the hub or product id is wrong.

export async function parcelOwns(settings: Settings, robloxId: number): Promise<boolean> {
  if (settings.parcel_hub_id === "" || settings.parcel_product_id === "") {
    throw new HttpError(503, "Parcel migration is not configured");
  }
  const params = new URLSearchParams({
    hubID: settings.parcel_hub_id,
    productID: settings.parcel_product_id,
    robloxID: String(robloxId),
  });
  const response = await fetch(`https://whitelist.parcelroblox.com/v1/check?${params}`);
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    details?: { owned?: boolean };
  };
  if (!response.ok) {
    throw new HttpError(
      502,
      `Parcel answered HTTP ${response.status}${body.message ? `: ${body.message}` : ""}`,
    );
  }
  return body.details?.owned === true;
}

// NYXYL / UMBRA --------------------------------------------------------------
//
// POST https://nyxyl.dev/api/obfuscate  Authorization: Bearer <key>
//   { source, options: { mode: "vm" | "ast" | "minify", ... } }
//   → 200 { obfuscated, bytes, mode }

export type ObfuscateMode = "vm" | "ast" | "minify";

export async function obfuscate(settings: Settings, source: string): Promise<string> {
  if (settings.nyxyl_api_key === "") throw new HttpError(503, "the obfuscator API key is not set");
  const response = await fetch("https://nyxyl.dev/api/obfuscate", {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.nyxyl_api_key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ source, options: { mode: settings.obfuscate_mode } }),
  });
  const body = (await response.json().catch(() => ({}))) as { obfuscated?: string; error?: string };
  if (!response.ok || typeof body.obfuscated !== "string") {
    throw new HttpError(
      502,
      `obfuscator failed (HTTP ${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  return body.obfuscated;
}

// Server binding (shared principals) -----------------------------------------
//
// A "principal" is nyxyl's shared, revocable key: one secret for a whole fleet of
// builds. We keep exactly one per licensee (keyed by their Roblox id), so every
// server-bound script we mint for that user folds the SAME secret and revoking the
// principal kills them all at once. See nyxyl-dev migrations/010_principals.sql.

function nyxylHeaders(settings: Settings): HeadersInit {
  if (settings.nyxyl_api_key === "") throw new HttpError(503, "the obfuscator API key is not set");
  return { authorization: `Bearer ${settings.nyxyl_api_key}`, "content-type": "application/json" };
}

// Create-or-get the principal for a Roblox user. Idempotent on externalRef, so it is
// safe to call on every download; returns the principal id to store on the licence.
export async function ensurePrincipal(settings: Settings, robloxId: number): Promise<string> {
  const response = await fetch("https://nyxyl.dev/api/principals", {
    method: "POST",
    headers: nyxylHeaders(settings),
    body: JSON.stringify({ externalRef: `roblox:${robloxId}`, label: `orbit:${robloxId}` }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    principal?: { id?: string };
    error?: string;
  };
  if (!response.ok || typeof body.principal?.id !== "string") {
    throw new HttpError(
      502,
      `principal create failed (HTTP ${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  return body.principal.id;
}

// Obfuscate a single script as a server-bound build under `principalId`. The returned
// artifact fetches its key from nyxyl at runtime (the key is not in the file) and is
// inert if the principal is revoked. Same string-in/string-out shape as obfuscate(),
// so it drops into the rbxmx transform in its place.
export async function obfuscateBound(
  settings: Settings,
  source: string,
  principalId: string,
): Promise<string> {
  const mode = settings.obfuscate_mode === "none" ? "ast" : settings.obfuscate_mode;
  const response = await fetch("https://nyxyl.dev/api/builds", {
    method: "POST",
    headers: nyxylHeaders(settings),
    body: JSON.stringify({
      source,
      options: { mode, keyBinding: "server" },
      principalId,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { artifact?: string; error?: string };
  if (!response.ok || typeof body.artifact !== "string") {
    throw new HttpError(
      502,
      `bound obfuscate failed (HTTP ${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  return body.artifact;
}

// Rotate a licensee's principal secret — every build minted against the OLD secret
// (including copies already downloaded) can no longer decrypt, so rotation is the
// cryptographic counterpart to issuing a fresh whitelist key.
export async function rotatePrincipal(settings: Settings, principalId: string): Promise<void> {
  const response = await fetch(`https://nyxyl.dev/api/principals/${principalId}/rotate`, {
    method: "POST",
    headers: nyxylHeaders(settings),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(
      502,
      `principal rotate failed (HTTP ${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
}

// Revoke a licensee's principal — kills every build they ever downloaded in one call.
// `restore` re-enables delivery (revoke is a reversible pause on nyxyl).
export async function setPrincipalRevoked(
  settings: Settings,
  principalId: string,
  revoked: boolean,
): Promise<void> {
  const action = revoked ? "revoke" : "restore";
  const response = await fetch(`https://nyxyl.dev/api/principals/${principalId}/${action}`, {
    method: "POST",
    headers: nyxylHeaders(settings),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(
      502,
      `principal ${action} failed (HTTP ${response.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
}
