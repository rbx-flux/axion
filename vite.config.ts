import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin reads wrangler.jsonc, runs the Worker (with a local
// D1) inside `vite dev`, and on `vite build` emits dist/axion/ with the
// bundled Worker, the client build and a wrangler.json pointing at both.
export default defineConfig({
  plugins: [react(), cloudflare()],
  // Files here are copied verbatim into the client build: _redirects lives
  // here.
  publicDir: "frontend/public",
});
