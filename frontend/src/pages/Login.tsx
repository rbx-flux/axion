import { Link, Navigate, useSearchParams } from "react-router-dom";
import { DISCORD_URL } from "../App";
import { loginUrl, useMe } from "../auth";
import { Badge, Icon, Notice, Spinner } from "../ui";

export function Login() {
  const { me, loading } = useMe();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/account";

  if (loading) return <Spinner />;
  if (me?.user) return <Navigate to={next} replace />;

  const error = params.get("error");

  return (
    <div className="narrow">
      <section className="card login">
        <p className="eyebrow">Sign in</p>
        <h1>Welcome back</h1>
        <p className="muted">
          Orbit uses your Discord account. Your Roblox account is found through Bloxlink in our
          Discord server, so make sure you have verified there first.
        </p>

        {error === "cancelled" && <Notice tone="warn">Sign-in was cancelled on Discord's side.</Notice>}
        {me && !me.discordConfigured && (
          <Notice tone="bad">Discord sign-in is not configured on this server yet{me.discordProblem ? `: ${me.discordProblem}` : ""}.</Notice>
        )}

        <a href={loginUrl(next)} className="btn btn-primary btn-lg" aria-disabled={me ? !me.discordConfigured : false}>
          <Icon name="discord" size={18} />
          <span>Continue with Discord</span>
        </a>

        <div className="login-alt" aria-disabled="true">
          <div>
            <span className="login-alt-title">
              Sign in with Roblox <Badge tone="neutral">work in progress</Badge>
            </span>
            <small className="muted">Direct Roblox sign-in is coming; Discord + Bloxlink for now.</small>
          </div>
          <Icon name="lock" />
        </div>

        <p className="fineprint">
          By signing in you agree to the <Link to="/terms">Terms of Service</Link> and{" "}
          <Link to="/privacy">Privacy Policy</Link>. Not verified yet?{" "}
          <a href={DISCORD_URL} target="_blank" rel="noreferrer">
            Join the Discord
          </a>{" "}
          and run <code>/verify</code> with Bloxlink.
        </p>
      </section>
    </div>
  );
}
