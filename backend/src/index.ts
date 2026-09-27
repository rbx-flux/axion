// Axion licence server, Cloudflare Workers edition, backed by D1 and R2.
//
// A *license* says a Roblox user owns the product. A *key* is a per-user
// token baked into that user's obfuscated build; whitelist checks confirm
// the key belongs to the user presenting it, so a build running under
// somebody else's account is caught and traced back to whoever it was
// issued to.
//
// Script-facing (backend/src/routes/v1.ts):
//   GET  /api/v1/whitelist?creatorId=123[&licenseKey=…][&gameId=…]   public
//   POST /api/v1/whitelist  { creatorId, licenseId, gameId, version } public
//   POST /api/v1/telemetry  { creatorId, licenseKey, gameId, version } public
//   POST /api/v1/diagnostics { creatorId, licenseKey, incidents, log, … } public
//   POST /api/v1/licenses/issue  { creatorId }                        Bearer secret
//   POST /api/v1/keys/issue      { creatorId, rotate? }               Bearer secret
//   GET  /api/v1/keys/mismatches [?creatorId=123]                     Bearer secret
//
// The site (backend/src/routes/account.ts, admin.ts): Discord sign-in,
// /api/me, per-user downloads, and everything under /api/admin.
//
// The schema lives in backend/migrations and is applied with
// `wrangler d1 migrations apply`.

import { loadSettings, log } from "./lib/db";
import { now } from "./lib/http";
import { registerAccount } from "./routes/account";
import { registerAdmin } from "./routes/admin";
import { registerV1 } from "./routes/v1";
import { Router } from "./router";

const router = new Router();
registerV1(router);
registerAccount(router);
registerAdmin(router);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // Only /api/* is configured to reach the Worker; anything else that does
    // arrive goes to the static frontend.
    if (!new URL(request.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return router.handle(request, env, ctx);
  },

  // Daily housekeeping: info-level log entries older than a day go, and so
  // does telemetry past the retention window, and resolved diagnostics
  // reports older than that same window. Warn/error logs, alarms and open
  // diagnostics reports stay until an admin resolves them.
  async scheduled(_controller, env): Promise<void> {
    const ts = now();
    const settings = await loadSettings(env.DB);
    const days = Math.max(1, Number(settings.telemetry_retention_days) || 30);
    const [logs, telemetry, , diagnostics] = await env.DB.batch([
      env.DB.prepare("DELETE FROM logs WHERE level = 'info' AND ts < ?1").bind(ts - 86400),
      env.DB.prepare("DELETE FROM telemetry WHERE ts < ?1").bind(ts - days * 86400),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(ts),
      env.DB.prepare("DELETE FROM diagnostics WHERE resolved_at IS NOT NULL AND resolved_at < ?1").bind(ts - days * 86400),
    ]);
    await log(
      env.DB,
      "info",
      "cron.cleanup",
      "system",
      `dropped ${logs.meta.changes} info log(s), ${telemetry.meta.changes} telemetry row(s), ${diagnostics.meta.changes} resolved diagnostics report(s)`,
    );
  },
} satisfies ExportedHandler<Env>;
