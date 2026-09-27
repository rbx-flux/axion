// Sign-in, the signed-in user's own data, and the licensed download.

import {
  checkState,
  clearSessionCookie,
  currentUser,
  discordAuthorizeUrl,
  discordConfigProblem,
  discordAvatarUrl,
  discordConfigured,
  fetchDiscordUser,
  isAdmin,
  isModerator,
  makeState,
  safeReturnTo,
  sessionCookie,
  SESSION_COOKIE,
} from "../lib/auth";
import {
  assignKey,
  createSession,
  deleteSession,
  findBuild,
  findFile,
  findLicense,
  grantLicense,
  listPublishedFiles,
  loadSettings,
  log,
  raiseAlarm,
  SESSION_TTL,
  upsertUser,
  type FileRow,
  type LicenseRow,
  type Settings,
  type UserRow,
} from "../lib/db";
import { HttpError, now, origin, randomToken, readCookie, redirect, reply } from "../lib/http";
import { bloxlinkLookup, obfuscate, parcelOwns, robloxUsername } from "../lib/integrations";
import { transformRbxmx } from "../lib/rbxmx";
import type { Router } from "../router";

// Minimum seconds between Bloxlink/Parcel re-checks a user can trigger.
const RECHECK_COOLDOWN = 60;

export function registerAccount(router: Router): void {
  // SIGN-IN ------------------------------------------------------------------

  router.get("/api/auth/discord", "none", async ({ request, env, url }) => {
    const problem = discordConfigProblem(env);
    if (problem !== null) throw new HttpError(503, `Discord sign-in is not configured: ${problem}`);
    const { state, cookie } = await makeState(request, env, safeReturnTo(url.searchParams.get("returnTo")));
    return redirect(discordAuthorizeUrl(env, origin(request), state), { "set-cookie": cookie });
  });

  router.get("/api/auth/discord/callback", "none", async ({ request, env, url }) => {
    const { returnTo, clearCookie } = await checkState(request, env, url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    if (code === null) {
      // The user hit "cancel" on Discord's consent screen.
      return redirect("/login?error=cancelled", { "set-cookie": clearCookie });
    }

    const profile = await fetchDiscordUser(env, origin(request), code);
    const name = profile.global_name ?? profile.username;
    const user = await upsertUser(env.DB, profile.id, name, profile.avatar);

    // First sign-in: look the Roblox account up once and remember it.
    if (user.roblox_id === null && user.bloxlink_checked_at === null) {
      await linkRoblox(env.DB, user, await loadSettings(env.DB));
    }

    const sessionId = randomToken(32);
    await createSession(env.DB, user.discord_id, sessionId);
    await log(env.DB, "info", "login", user.discord_id, `${name} signed in`);

    const headers = new Headers({ location: returnTo });
    headers.append("set-cookie", clearCookie);
    headers.append("set-cookie", sessionCookie(request, sessionId, SESSION_TTL));
    return new Response(null, { status: 302, headers });
  });

  router.post("/api/auth/logout", "none", async ({ request, env }) => {
    const id = readCookie(request, SESSION_COOKIE);
    if (id !== null) await deleteSession(env.DB, id);
    return reply(200, { ok: true }, { "set-cookie": clearSessionCookie(request) });
  });

  // ME -----------------------------------------------------------------------

  // Everything the account page needs in one call. Works signed out too
  // (`user: null`), so the app can render its header from it.
  router.get("/api/me", "none", async ({ request, env }) => {
    const user = await currentUser(request, env);
    const settings = await loadSettings(env.DB);
    if (user === null) {
      return reply(200, { ok: true, user: null, discordConfigured: discordConfigured(env), discordProblem: discordConfigProblem(env) });
    }
    const license = user.roblox_id === null ? null : await findLicense(env.DB, user.roblox_id);
    const files = license === null ? [] : await listPublishedFiles(env.DB, license.tester === 1);
    return reply(200, {
      ok: true,
      discordConfigured: discordConfigured(env),
      user: presentUser(user),
      license: presentLicense(license),
      files: files.map(presentFile),
      parcelEnabled: settings.parcel_enabled === "true",
      bloxlinkConfigured: settings.bloxlink_guild_id !== "" && settings.bloxlink_api_key !== "",
    });
  });

  // Runs the Bloxlink lookup again (after the user verified, or moved accounts).
  router.post("/api/me/reverify", "session", async ({ env, user }) => {
    const u = user as UserRow;
    if (u.bloxlink_checked_at !== null && now() - u.bloxlink_checked_at < RECHECK_COOLDOWN) {
      throw new HttpError(429, `please wait ${RECHECK_COOLDOWN} seconds between checks`);
    }
    const result = await linkRoblox(env.DB, u, await loadSettings(env.DB));
    return reply(200, { ok: true, robloxId: result.roblox_id, robloxUsername: result.roblox_username, error: result.bloxlink_error });
  });

  // "I bought Orbit on Parcel": ask Parcel whether this Roblox account owns
  // the product there and, if so, issue a licence here.
  router.post("/api/me/parcel", "session", async ({ env, user }) => {
    const u = user as UserRow;
    const settings = await loadSettings(env.DB);
    if (settings.parcel_enabled !== "true") throw new HttpError(503, "Parcel migration is switched off");
    if (u.roblox_id === null) throw new HttpError(409, "link your Roblox account first");
    if (u.parcel_checked_at !== null && now() - u.parcel_checked_at < RECHECK_COOLDOWN) {
      throw new HttpError(429, `please wait ${RECHECK_COOLDOWN} seconds between checks`);
    }
    await env.DB.prepare("UPDATE users SET parcel_checked_at = ?1 WHERE discord_id = ?2")
      .bind(now(), u.discord_id)
      .run();

    const existing = await findLicense(env.DB, u.roblox_id);
    if (existing !== null) return reply(200, { ok: true, alreadyLicensed: true, license: presentLicense(existing) });

    let owned: boolean;
    try {
      owned = await parcelOwns(settings, u.roblox_id);
    } catch (error) {
      await log(env.DB, "warn", "parcel.error", u.discord_id, `Parcel check failed for ${u.roblox_id}: ${(error as Error).message}`, {
        robloxId: u.roblox_id,
      });
      throw error;
    }
    if (!owned) {
      await log(env.DB, "info", "parcel.denied", u.discord_id, `Parcel says ${u.roblox_id} does not own the product`, {
        robloxId: u.roblox_id,
      });
      return reply(200, { ok: true, owned: false });
    }
    const { license } = await grantLicense(env.DB, u.roblox_id, "parcel", null);
    await log(env.DB, "info", "license.parcel", u.discord_id, `licensed ${u.roblox_id} via Parcel migration`, {
      robloxId: u.roblox_id,
    });
    return reply(201, { ok: true, owned: true, license: presentLicense(license) });
  });

  // Asks the admins to delete everything stored about this account. Shows up
  // on the admin dashboard as an alarm; the admin fulfils it from there.
  router.post("/api/me/deletion-request", "session", async ({ env, user }) => {
    const u = user as UserRow;
    await raiseAlarm(env.DB, {
      kind: "deletion_request",
      level: "warn",
      creatorId: u.roblox_id,
      detail: JSON.stringify({ discordId: u.discord_id, username: u.discord_username }),
    });
    await log(env.DB, "warn", "deletion.request", u.discord_id, `${u.discord_username} asked for their data to be deleted`, {
      robloxId: u.roblox_id,
    });
    return reply(200, { ok: true });
  });

  // DOWNLOAD -----------------------------------------------------------------

  // The licensed user's own build of a published release: the key marker
  // swapped for their key, then obfuscated. Built once per (release, key)
  // and cached in R2. Tester-channel releases are only for product testers;
  // to anyone else they do not exist.
  router.get("/api/download/:fileId", "session", async ({ env, params, user }) => {
    const u = user as UserRow;
    if (u.roblox_id === null) throw new HttpError(409, "link your Roblox account first");
    const file = await findFile(env.DB, params.fileId);
    if (file === null || (file.published !== 1 && !isAdmin(u))) throw new HttpError(404, "no such file");

    let license = await findLicense(env.DB, u.roblox_id);
    if (file.channel === "tester" && license?.tester !== 1 && !isAdmin(u)) throw new HttpError(404, "no such file");
    if (license === null) throw new HttpError(403, "you are not licensed");
    if (license.key === null) {
      const key = await assignKey(env.DB, u.roblox_id);
      license = { ...license, key, key_issued_at: now() };
      await log(env.DB, "info", "key.issue", u.discord_id, `key issued to ${u.roblox_id} on first download`, {
        robloxId: u.roblox_id,
      });
    }
    const key = license.key as string;

    const cached = await findBuild(env.DB, file.id, u.roblox_id);
    let object = cached !== null && cached.key === key ? await env.FILES.get(cached.r2_key) : null;
    if (object === null) {
      object = await build(env, file, license, key, u);
    }

    await log(env.DB, "info", "download", u.discord_id, `${u.roblox_id} downloaded ${file.name}${file.channel === "tester" ? " (tester build)" : ""}`, {
      robloxId: u.roblox_id,
      fileId: file.id,
      channel: file.channel,
    });
    const filename = file.name.toLowerCase().endsWith(".rbxmx") ? file.name : `${file.name}.rbxmx`;
    return new Response(object.body, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`,
        "cache-control": "private, no-store",
      },
    });
  });
}

// Looks the user's Roblox account up on Bloxlink and stores the result.
async function linkRoblox(db: D1Database, user: UserRow, settings: Settings): Promise<UserRow> {
  const result = await bloxlinkLookup(settings, user.discord_id);
  const username =
    result.robloxId === null
      ? null
      : (result.robloxUsername ?? (await robloxUsername(result.robloxId)));
  await db
    .prepare(
      `UPDATE users SET roblox_id = ?1, roblox_username = ?2, bloxlink_checked_at = ?3, bloxlink_error = ?4
       WHERE discord_id = ?5`,
    )
    .bind(result.robloxId, username, now(), result.error, user.discord_id)
    .run();
  await log(
    db,
    "info",
    result.robloxId === null ? "bloxlink.unlinked" : "bloxlink.linked",
    user.discord_id,
    result.robloxId === null
      ? `Bloxlink could not link ${user.discord_username}: ${result.error}`
      : `${user.discord_username} is Roblox ${username ?? "?"} (${result.robloxId})`,
  );
  return {
    ...user,
    roblox_id: result.robloxId,
    roblox_username: username,
    bloxlink_checked_at: now(),
    bloxlink_error: result.error,
  };
}

// Produces the user's build of `file`, stores it, and returns the R2 object.
async function build(
  env: Env,
  file: FileRow,
  license: LicenseRow,
  key: string,
  user: UserRow,
): Promise<R2ObjectBody> {
  const source = await env.FILES.get(file.r2_key);
  if (source === null) throw new HttpError(500, "the release file is missing from storage");
  const settings = await loadSettings(env.DB);
  const obfuscator = settings.obfuscate_mode === "none" ? null : (s: string) => obfuscate(settings, s);

  const started = Date.now();
  const result = await transformRbxmx(await source.text(), {
    marker: settings.key_marker || "__LICENSE_KEY",
    key,
    scope: settings.obfuscate_scope === "all" ? "all" : "marked",
    obfuscate: obfuscator,
  });

  const r2Key = `builds/${file.id}/${license.creator_id}.rbxmx`;
  await env.FILES.put(r2Key, result.xml, { httpMetadata: { contentType: "application/xml" } });
  await env.DB.prepare(
    `INSERT INTO builds (file_id, creator_id, key, r2_key, size, built_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (file_id, creator_id) DO UPDATE SET key = excluded.key, r2_key = excluded.r2_key, size = excluded.size, built_at = excluded.built_at`,
  )
    .bind(file.id, license.creator_id, key, r2Key, result.xml.length, now())
    .run();
  await log(env.DB, "info", "build", user.discord_id, `built ${file.name} for ${license.creator_id}`, {
    robloxId: license.creator_id,
    fileId: file.id,
    scripts: result.scripts,
    replaced: result.replaced,
    obfuscated: result.obfuscated,
    ms: Date.now() - started,
  });

  const object = await env.FILES.get(r2Key);
  if (object === null) throw new HttpError(500, "the build vanished from storage");
  return object;
}

// PRESENTERS -----------------------------------------------------------------

export function presentUser(user: UserRow) {
  return {
    discordId: user.discord_id,
    username: user.discord_username,
    avatar: discordAvatarUrl(user),
    robloxId: user.roblox_id,
    robloxUsername: user.roblox_username,
    bloxlinkCheckedAt: user.bloxlink_checked_at,
    bloxlinkError: user.bloxlink_error,
    parcelCheckedAt: user.parcel_checked_at,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    admin: isAdmin(user),
    moderator: isModerator(user),
  };
}

export function presentLicense(license: LicenseRow | null) {
  if (license === null) return null;
  return {
    creatorId: license.creator_id,
    licensedAt: license.licensed_at,
    source: license.source,
    hasKey: license.key !== null,
    keyIssuedAt: license.key_issued_at,
    tester: license.tester === 1,
    testerSince: license.tester_since,
  };
}

export function presentFile(file: FileRow) {
  return {
    id: file.id,
    name: file.name,
    version: file.version,
    notes: file.notes,
    size: file.size,
    published: file.published === 1,
    channel: file.channel,
    markerHits: file.marker_hits,
    uploadedAt: file.uploaded_at,
    uploadedBy: file.uploaded_by,
  };
}
