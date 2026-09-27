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
