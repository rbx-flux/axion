// Placeholder frontend: exercises the public whitelist endpoint. The real
// site goes here.

import { useEffect, useState, type FormEvent } from "react";

// The Worker serves index.html for every path it does not know
// (`not_found_handling: "single-page-application"`), so unknown paths land
// here and get the not-found view.
export function App() {
  const path = window.location.pathname;
  return (
    <main className="wrap">
      {path === "/" ? <Home /> : <NotFound />}
    </main>
  );
}

function Home() {
  return (
    <>
      <header className="hero">
        <p className="eyebrow">Placeholder frontend</p>
        <h1>Axion</h1>
        <p className="lede">
          Licence server for the Roblox product. The real site goes here; for now this page
          lets you poke the API.
        </p>
      </header>

      <WhitelistCheck />
      <Endpoints />

      <footer className="foot">
        <ApiStatus />
      </footer>
    </>
  );
}

function NotFound() {
  return (
    <header className="hero">
      <p className="eyebrow">404</p>
      <h1>Nothing here</h1>
      <p className="lede">
        That page does not exist. <a href="/">Back to the start.</a>
      </p>
    </header>
  );
}

// The response shape of GET /api/v1/whitelist, or the error shape every
// endpoint shares.
interface WhitelistResult {
  status: number;
  body: { ok: boolean; owned?: boolean; error?: string } & Record<string, unknown>;
}

function WhitelistCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WhitelistResult | Error | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams({ creatorId: String(data.get("creatorId")).trim() });
    const licenseKey = String(data.get("licenseKey") ?? "").trim();
    if (licenseKey) params.set("licenseKey", licenseKey);

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/whitelist?${params}`);
      setResult({ status: response.status, body: await response.json() });
    } catch (error) {
      setResult(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy(false);
    }
  }

  let state: "ok" | "bad" | "" = "";
  let text = "…";
  if (result instanceof Error) {
    state = "bad";
    text = `Request failed: ${result.message}`;
  } else if (result !== null) {
    state = result.status < 400 && result.body.owned ? "ok" : "bad";
    text = `HTTP ${result.status}\n${JSON.stringify(result.body, null, 2)}`;
  }

  return (
    <section className="card">
      <h2>Check a licence</h2>
      <p className="hint">
        Calls <code>GET /api/v1/whitelist</code>. Public, no secret needed.
      </p>
      <form className="form" onSubmit={submit}>
        <label>
          <span>Roblox user id</span>
          <input name="creatorId" type="text" inputMode="numeric" placeholder="123456789" required />
        </label>
        <label>
          <span>
            Build key <em>(optional; a wrong one is recorded as a mismatch)</em>
          </span>
          <input
            name="licenseKey"
            type="text"
            placeholder="AXION-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={busy}>
          Check
        </button>
      </form>
      {(busy || result !== null) && (
        <pre className="result" data-state={busy ? "" : state}>
          {busy ? "…" : text}
        </pre>
      )}
    </section>
  );
}

const ENDPOINTS = [
  {
    route: "GET /api/v1/whitelist",
    auth: "none",
    does: (
      <>
        Is <code>creatorId</code> licensed, and is <code>licenseKey</code> the key issued to them?
      </>
    ),
  },
  { route: "POST /api/v1/licenses/issue", auth: "Bearer", does: "Grant a user the product." },
  {
    route: "POST /api/v1/keys/issue",
    auth: "Bearer",
    does: (
      <>
        Issue the key for a user's build. One per user; <code>rotate</code> replaces it.
      </>
    ),
  },
  {
    route: "GET /api/v1/keys/mismatches",
    auth: "Bearer",
    does: "Keys presented by someone they were not issued to — i.e. leaked builds.",
  },
];

function Endpoints() {
  return (
    <section className="card">
      <h2>Endpoints</h2>
      <table className="endpoints">
        <thead>
          <tr>
            <th>Route</th>
            <th>Auth</th>
            <th>Does</th>
          </tr>
        </thead>
        <tbody>
          {ENDPOINTS.map((endpoint) => (
            <tr key={endpoint.route}>
              <td>
                <code>{endpoint.route}</code>
              </td>
              <td>{endpoint.auth}</td>
              <td>{endpoint.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Reachability probe: a 400 (missing creatorId) still proves the API is up.
function ApiStatus() {
  const [status, setStatus] = useState<{ state: "" | "ok" | "bad"; text: string }>({
    state: "",
    text: "Checking API…",
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/whitelist")
      .then((response) => {
        if (cancelled) return;
        const up = response.status === 400;
        setStatus({
          state: up ? "ok" : "bad",
          text: up ? "API reachable" : `API returned HTTP ${response.status}`,
        });
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "bad", text: "API unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span className="status" data-state={status.state} aria-live="polite">
      {status.text}
    </span>
  );
}
