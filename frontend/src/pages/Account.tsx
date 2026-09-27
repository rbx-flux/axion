import { useState } from "react";
import { Navigate } from "react-router-dom";
import { DISCORD_URL } from "../App";
import { api, type License, type Release, type User } from "../api";
import { useMe } from "../auth";
import { ActionMessage, Badge, Button, Empty, Icon, Mono, Spinner, Time, formatBytes, useAction } from "../ui";

export function Account() {
  const { me, loading, refresh, logout } = useMe();
  if (loading) return <Spinner />;
  if (!me?.user) return <Navigate to="/login?next=/account" replace />;
  const user = me.user;
  const license = me.license ?? null;
  const files = (me.files ?? []).filter((f) => f.channel !== "tester");
  const testerFiles = (me.files ?? []).filter((f) => f.channel === "tester");

  return (
    <div className="account">
      <header className="page-head">
        <div className="identity">
          {user.avatar ? <img src={user.avatar} alt="" width={48} height={48} className="avatar" /> : <span className="avatar avatar-blank"><Icon name="user" size={22} /></span>}
          <div>
            <p className="eyebrow">Account</p>
            <h1>{user.username}</h1>
            <p className="muted small">
              Discord <Mono>{user.discordId}</Mono> · member since <Time at={user.createdAt} exact />
            </p>
          </div>
        </div>
        <Button icon="logout" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>

      <div className="grid-2">
        <RobloxCard user={user} configured={me.bloxlinkConfigured ?? false} refresh={refresh} />
        <LicenseCard license={license} linked={user.robloxId !== null} parcelEnabled={me.parcelEnabled ?? false} refresh={refresh} />
      </div>

      <section className="card" aria-labelledby="dl-h">
        <div className="card-head">
          <h2 id="dl-h">Downloads</h2>
          {license && <Badge tone="ok">licensed</Badge>}
        </div>
        {license === null ? (
          <Empty>Downloads unlock once your account holds a licence.</Empty>
        ) : files.length === 0 ? (
          <Empty>No release is published right now. Check back soon.</Empty>
        ) : (
          <ReleaseList files={files} />
        )}
        {license && (
          <p className="fineprint">
            Your download is built on request with your personal key inside and then obfuscated, so the
            first download of a release can take a little while. Do not share the file: the key inside it
            identifies you.
          </p>
        )}
      </section>

      {license?.tester && (
        <section className="card card-tester" aria-labelledby="tst-h">
          <div className="card-head">
            <h2 id="tst-h">Tester builds</h2>
            <Badge tone="accent">product tester</Badge>
          </div>
          {testerFiles.length === 0 ? (
            <Empty>No tester build is out right now. New ones show up here before they reach everyone else.</Empty>
          ) : (
            <ReleaseList files={testerFiles} tester />
          )}
          <p className="fineprint">
            These are non-production builds for testing only: expect bugs, and do not use them in a live
            game. They are built with your personal key just like the main release, so keep them to
            yourself.
          </p>
        </section>
      )}

      <DangerZone />
    </div>
  );
}

function ReleaseList({ files, tester = false }: { files: Release[]; tester?: boolean }) {
  return (
    <ul className="release-list">
      {files.map((f) => (
        <li key={f.id} className="release">
          <div>
            <strong>{f.name}</strong>
            <span className="muted small">
              {f.version && <Mono>{f.version}</Mono>} · {formatBytes(f.size)} · <Time at={f.uploadedAt} exact />
            </span>
            {f.notes && <p className="release-notes">{f.notes}</p>}
          </div>
          <a href={`/api/download/${f.id}`} className={`btn ${tester ? "btn-ghost" : "btn-primary"}`} download>
            <Icon name={tester ? "flask" : "download"} />
            <span>{tester ? "Download test build" : "Download"}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function RobloxCard({ user, configured, refresh }: { user: User; configured: boolean; refresh: () => Promise<void> }) {
  const { busy, message, setMessage, run } = useAction();
  const linked = user.robloxId !== null;
  return (
    <section className="card" aria-labelledby="rbx-h">
      <div className="card-head">
        <h2 id="rbx-h">Roblox account</h2>
        <Badge tone={linked ? "ok" : "warn"}>{linked ? "linked" : "not linked"}</Badge>
      </div>
      {linked ? (
        <p>
          <strong>{user.robloxUsername ?? "Roblox user"}</strong> <Mono>{user.robloxId}</Mono>
          <br />
          <span className="muted small">
            via Bloxlink, checked <Time at={user.bloxlinkCheckedAt} />
          </span>
        </p>
      ) : (
        <p className="muted">
          {!configured
            ? "Bloxlink is not configured on this server yet."
            : user.bloxlinkError
              ? `Bloxlink said: ${user.bloxlinkError}.`
              : "We have not looked your Roblox account up yet."}{" "}
          Join the{" "}
          <a href={DISCORD_URL} target="_blank" rel="noreferrer">
            Discord
          </a>
          , verify with Bloxlink, then check again.
        </p>
      )}
      <div className="actions">
        <Button icon="refresh" busy={busy} onClick={() => void run(async () => {
          const r = await api.post<{ robloxId: number | null; error: string | null }>("/api/me/reverify");
          await refresh();
          return r.robloxId === null ? `Still not linked: ${r.error ?? "unknown reason"}` : `Linked to Roblox ${r.robloxId}`;
        })}>
          {linked ? "Re-check" : "Check again"}
        </Button>
      </div>
      <ActionMessage message={message} onClose={() => setMessage(null)} />
    </section>
  );
}

function LicenseCard({ license, linked, parcelEnabled, refresh }: { license: License | null; linked: boolean; parcelEnabled: boolean; refresh: () => Promise<void> }) {
  const { busy, message, setMessage, run } = useAction();
  return (
    <section className="card" aria-labelledby="lic-h">
      <div className="card-head">
        <h2 id="lic-h">Licence</h2>
        <Badge tone={license ? "ok" : "neutral"}>{license ? "active" : "none"}</Badge>
      </div>
      {license ? (
        <dl className="facts">
          <div>
            <dt>Licensed</dt>
            <dd>
              <Time at={license.licensedAt} exact />
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{sourceLabel(license.source)}</dd>
          </div>
          <div>
            <dt>Build key</dt>
            <dd>{license.hasKey ? <>issued <Time at={license.keyIssuedAt} /></> : "issued on first download"}</dd>
          </div>
          {license.tester && (
            <div>
              <dt>Product tester</dt>
              <dd>since <Time at={license.testerSince} exact /></dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="muted">
          This Roblox account does not hold an Orbit licence. Purchasing is paused at the moment.
          {parcelEnabled && " Bought Orbit on Parcel before? Claim it below."}
        </p>
      )}
      {license === null && parcelEnabled && (
        <div className="actions">
          <Button
            variant="primary"
            icon="key"
            busy={busy}
            disabled={!linked}
            title={linked ? undefined : "Link your Roblox account first"}
            onClick={() => void run(async () => {
              const r = await api.post<{ owned?: boolean; alreadyLicensed?: boolean }>("/api/me/parcel");
              await refresh();
              if (r.alreadyLicensed) return "You already hold a licence.";
              return r.owned ? "Parcel confirms your purchase — licence issued." : "Parcel has no purchase for this Roblox account.";
            })}
          >
            I bought Orbit on Parcel
          </Button>
        </div>
      )}
      <ActionMessage message={message} onClose={() => setMessage(null)} />
    </section>
  );
}

function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const { busy, message, setMessage, run } = useAction();
  return (
    <section className="card card-quiet" aria-labelledby="dz-h">
      <h2 id="dz-h" className="small-h">
        Your data
      </h2>
      <p className="muted small">
        We store your Discord id and name, your Roblox id, your licence and key, and anonymous
        telemetry from builds. You can ask us to delete it; an admin will be notified and handle the
        request. Deleting your account also removes your licence.
      </p>
      {confirming ? (
        <div className="actions">
          <Button variant="danger" icon="trash" busy={busy} onClick={() => void run(async () => {
            await api.post("/api/me/deletion-request");
            setConfirming(false);
            return "Request sent. An admin has been notified.";
          })}>
            Yes, request deletion
          </Button>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="actions">
          <Button icon="trash" onClick={() => setConfirming(true)}>
            Request data deletion
          </Button>
        </div>
      )}
      <ActionMessage message={message} onClose={() => setMessage(null)} />
    </section>
  );
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "parcel":
      return "migrated from Parcel";
    case "admin":
      return "issued by an admin";
    case "moderator":
      return "issued by a moderator";
    case "import":
      return "imported";
    case "api":
      return "issued via API";
    default:
      return source;
  }
}
