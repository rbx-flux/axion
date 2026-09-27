// A small method + URLPattern router with three levels of access.

import { currentUser, isAdmin, isModerator } from "./lib/auth";
import type { UserRow } from "./lib/db";
import { HttpError, constantTimeEquals, fail, readInput, reply, type Input } from "./lib/http";

export interface Context {
  request: Request;
  env: Env;
  url: URL;
  input: Input;
  params: Record<string, string>;
  // The signed-in user, when the route asked for one.
  user: UserRow | null;
  ctx: ExecutionContext;
}

export type Handler = (c: Context) => Promise<Response>;

// none     public
// secret   Authorization: Bearer <API_SECRET> (script-facing endpoints)
// session    a signed-in Discord user
// moderator  a signed-in user on the moderator or admin list
// admin      a signed-in user on the admin list
export type Access = "none" | "secret" | "session" | "moderator" | "admin";

interface Route {
  method: string;
  pattern: URLPattern;
  access: Access;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, access: Access, handler: Handler): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname: path }), access, handler });
    return this;
  }

  get(path: string, access: Access, handler: Handler): this {
    return this.add("GET", path, access, handler);
  }
  post(path: string, access: Access, handler: Handler): this {
    return this.add("POST", path, access, handler);
  }
  put(path: string, access: Access, handler: Handler): this {
    return this.add("PUT", path, access, handler);
  }
  patch(path: string, access: Access, handler: Handler): this {
    return this.add("PATCH", path, access, handler);
  }
  delete(path: string, access: Access, handler: Handler): this {
    return this.add("DELETE", path, access, handler);
  }

  async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const matching = this.routes.filter((r) => r.pattern.test(url));
    if (matching.length === 0) return fail(404, "not found");

    const route = matching.find((r) => r.method === request.method);
    if (route === undefined) {
      const allow = [...new Set(matching.map((r) => r.method))].sort().join(", ");
      return reply(405, { ok: false, error: "method not allowed" }, { allow });
    }

    let user: UserRow | null = null;
    if (route.access === "secret") {
      if (!bearerAuthorized(request, env)) return fail(401, "unauthorized");
    } else if (route.access === "session" || route.access === "moderator" || route.access === "admin") {
      user = await currentUser(request, env);
      if (user === null) return fail(401, "sign in first");
      if (route.access === "admin" && !isAdmin(user)) return fail(403, "admins only");
      if (route.access === "moderator" && !isModerator(user)) return fail(403, "moderators only");
    }

    let input: Input;
    try {
      input = await readInput(request);
    } catch {
      return fail(400, "body must be valid json");
    }

    const params: Record<string, string> = {};
    const groups = route.pattern.exec(url)?.pathname.groups ?? {};
    for (const [k, v] of Object.entries(groups)) if (v !== undefined) params[k] = decodeURIComponent(v);

    try {
      return await route.handler({ request, env, url, input, params, user, ctx });
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message, error.extra);
      // Logged for observability; the client only learns that we failed.
      console.error(`${request.method} ${url.pathname} failed:`, error);
      return fail(500, "internal error");
    }
  }
}

function bearerAuthorized(request: Request, env: Env): boolean {
  if (typeof env.API_SECRET !== "string" || env.API_SECRET.length < 16) return false;
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const match = /^bearer\s+(.+)$/i.exec(header);
  if (match === null) return false;
  return constantTimeEquals(match[1], env.API_SECRET);
}
