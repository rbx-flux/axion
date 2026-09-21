// Bindings that wrangler cannot infer from wrangler.jsonc: secrets set with
// `wrangler secret put` (and `.dev.vars` locally). Everything else lives in
// the generated worker-configuration.d.ts.
interface Env {
  API_SECRET: string;
}
