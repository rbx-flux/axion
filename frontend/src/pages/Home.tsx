import { Link } from "react-router-dom";
import { DISCORD_URL, DOCS_URL, LICENSE_AGREEMENT_URL } from "../App";
import { loginUrl, useMe } from "../auth";
import { Icon, Mark } from "../ui";

export function Home() {
  const { me } = useMe();
  const user = me?.user ?? null;
  const licensed = Boolean(me?.license);

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">
          <Mark size={14} /> flux studio
        </p>
        <h1>
          Orbit.
          <br />
          <span className="dim">Simple yet elegant.</span>
        </h1>
        <p className="lede">
          One licence per Roblox account, one build per licence. Sign in with Discord, and your
          copy of Orbit is built for you with your own key inside.
        </p>
        <div className="hero-actions">
          {licensed ? (
            <Link to="/account" className="btn btn-primary">
              <Icon name="download" />
              <span>Go to downloads</span>
            </Link>
          ) : user ? (
            <Link to="/account" className="btn btn-primary">
              <Icon name="user" />
              <span>Your account</span>
            </Link>
          ) : (
            <a href={loginUrl()} className="btn btn-primary">
              <Icon name="discord" />
              <span>Sign in with Discord</span>
            </a>
          )}
          <a href={DOCS_URL} className="btn btn-ghost" target="_blank" rel="noreferrer">
            <Icon name="book" />
            <span>Read the docs</span>
          </a>
        </div>
      </section>

      <section className="grid-2">
        <div className="card card-buy" aria-labelledby="buy-h">
          <div className="card-head">
            <h2 id="buy-h">Get Orbit</h2>
            <span className="price">
              <span className="robux" aria-hidden="true">
                R$
              </span>
              <span className="sr-only">Robux</span> 199
            </span>
          </div>
          <p className="muted">
            Purchasing is paused while we move off Parcel. If you already bought Orbit there, sign in
            and claim your licence from your account page — nothing to pay twice.
          </p>
          <button className="btn btn-primary" disabled aria-disabled="true" title="Purchasing is currently unavailable">
            <Icon name="cart" />
            <span>Buy · unavailable</span>
          </button>
          <p className="fineprint">
            Use is governed by the{" "}
            <a href={LICENSE_AGREEMENT_URL} target="_blank" rel="noreferrer">
              License Agreement
            </a>
            .
          </p>
        </div>

        <div className="card" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps">
            <li>
              <span>
                <strong>Sign in with Discord.</strong> We look up your Roblox account through Bloxlink, once.
              </span>
            </li>
            <li>
              <span>
                <strong>Your licence is checked.</strong> Bought on Parcel? Claim it. New here? Purchasing opens soon.
              </span>
            </li>
            <li>
              <span>
                <strong>Download your build.</strong> Each download is compiled with a key that is yours alone.
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section className="links-row">
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="link-tile">
          <Icon name="book" size={18} />
          <span>
            <strong>Documentation</strong>
            <small>Setup guides and reference</small>
          </span>
          <Icon name="external" size={12} />
        </a>
        <a href={LICENSE_AGREEMENT_URL} target="_blank" rel="noreferrer" className="link-tile">
          <Icon name="shield" size={18} />
          <span>
            <strong>License Agreement</strong>
            <small>What you may and may not do</small>
          </span>
          <Icon name="external" size={12} />
        </a>
        <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="link-tile">
          <Icon name="discord" size={18} />
          <span>
            <strong>Discord</strong>
            <small>Support and verification</small>
          </span>
          <Icon name="external" size={12} />
        </a>
      </section>
    </div>
  );
}
