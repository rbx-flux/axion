// Terms of Service and Privacy Policy. Plain prose, one component each,
// sharing the document chrome. Placeholders that still need filling in are
// marked with <Placeholder/> so they stand out on the page.

import { Link } from "react-router-dom";
import { LICENSE_AGREEMENT_URL } from "../App";
import { Icon } from "../ui";

const UPDATED = "21 September 2026";
const OPERATOR = "Flux Studio";

function Placeholder({ what }: { what: string }) {
  return (
    <mark className="placeholder" title="To be filled in">
      [placeholder: {what}]
    </mark>
  );
}

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="doc">
      <div className="doc-draft" role="status">
        <Icon name="alert" />
        <p>
          <strong>Placeholder.</strong> This document is a draft and not yet in force. It will be
          replaced once our legal team has finished the final version.
        </p>
      </div>
      <header>
        <p className="eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="muted small">
          Last updated {UPDATED} · operated by {OPERATOR}
        </p>
      </header>
      <nav className="doc-nav" aria-label="Legal documents">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <a href={LICENSE_AGREEMENT_URL} target="_blank" rel="noreferrer">
          License Agreement
        </a>
      </nav>
      {children}
    </article>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of Service">
      <p className="lede">
        These terms cover the use of the Orbit website at orbitroblox.xyz (the "Site") and the
        licensing service behind it. The Orbit software itself is licensed separately under the{" "}
        <a href={LICENSE_AGREEMENT_URL} target="_blank" rel="noreferrer">
          License Agreement
        </a>
        ; where the two overlap, the License Agreement governs the software and these terms govern
        the Site.
      </p>

      <h2>1. Who we are</h2>
      <p>
        The Site is operated by {OPERATOR} ("we", "us"). The Orbit brand is owned by a member of{" "}
        {OPERATOR} resident in the United States; the servers and database are operated by a member
        resident in Austria. Contact: <Placeholder what="contact email" />.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You sign in with a Discord account. To link a Roblox account we query Bloxlink for the Roblox
        account you verified in our Discord server. You are responsible for keeping both accounts
        secure. You must be old enough to hold a Discord account under Discord's terms and, where
        you live in the EU, at least 16 or have parental consent.
      </p>

      <h2>3. Licences and downloads</h2>
      <p>
        A licence is tied to one Roblox account. It lets that account download and use Orbit under
        the License Agreement. Downloads are generated per user: each file contains a licence key
        that is unique to you. You must not share, publish or redistribute a download, remove or
        alter the key, or run a build issued to somebody else. Doing so lets us identify the
        account the build was issued to, and we may suspend or revoke that licence.
      </p>
      <p>
        Purchasing through the Site is currently unavailable. Licences bought previously through
        Parcel can be claimed by signing in and confirming ownership; we rely on Parcel's answer and
        are not responsible for its accuracy.
      </p>

      <h2>4. Licence checks and telemetry</h2>
      <p>
        Orbit builds contact the Site while running to confirm the licence and key and to report
        basic telemetry: the Roblox user id of the game owner, the licence key, the Roblox game
        (universe) id it runs in, and the Orbit version. We use this to detect leaked or misused
        builds and to understand which versions are in use. Details are in the{" "}
        <Link to="/privacy">Privacy Policy</Link>. Blocking these requests may stop Orbit from
        working.
      </p>

      <h2>5. Acceptable use</h2>
      <ul>
        <li>Do not attempt to bypass licence checks, forge telemetry or probe the API for other users' data.</li>
        <li>Do not overload the Site or its API with automated traffic.</li>
        <li>Do not use the Site for anything unlawful or against Roblox's or Discord's terms.</li>
      </ul>

      <h2>6. Availability and changes</h2>
      <p>
        The Site is provided as is. We aim to keep it and the licence API available but do not
        guarantee uptime, and we may change or discontinue features. We may update these terms; the
        date at the top tells you when. Continued use after a change means you accept it.
      </p>

      <h2>7. Liability</h2>
      <p>
        To the extent permitted by law, we are not liable for indirect or consequential loss arising
        from the Site or the licence service, including lost revenue from a Roblox experience. Nothing
        here limits liability that cannot be limited under applicable law.
      </p>

      <h2>8. Governing law</h2>
      <p>
        <Placeholder what="governing law and venue" />. Consumers in the EU keep the protections of
        the law of their country of residence regardless.
      </p>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p className="lede">
        This policy explains what the Orbit Site and licence service store about you, why, and for
        how long. It is written to meet the GDPR, because the service is operated from Austria.
      </p>

      <h2>1. Controller</h2>
      <p>
        {OPERATOR}, contact <Placeholder what="contact email" />. The infrastructure (Cloudflare
        Workers, D1 and R2) is operated from Austria; the Orbit brand is owned by a US-resident
        member of {OPERATOR}.
      </p>

      <h2>2. What we store</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Where it comes from</th>
            <th>Why</th>
            <th>Kept</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Discord user id, display name, avatar hash</td>
            <td>Discord sign-in (OAuth2, <code>identify</code> scope)</td>
            <td>Your account on the Site</td>
            <td>Until you ask us to delete it</td>
          </tr>
          <tr>
            <td>Roblox user id and username</td>
            <td>Bloxlink, based on your verification in our Discord server</td>
            <td>Linking the licence to your Roblox account</td>
            <td>Until deletion; re-checked only when you ask</td>
          </tr>
          <tr>
            <td>Licence record and licence key, when they were issued, and by what route (admin, Parcel, import)</td>
            <td>Created by us</td>
            <td>Proving ownership; identifying leaked builds</td>
            <td>For the life of the licence</td>
          </tr>
          <tr>
            <td>Your generated build file</td>
            <td>Created by us on download</td>
            <td>So repeated downloads do not need rebuilding</td>
            <td>Until the release is removed or your key changes</td>
          </tr>
          <tr>
            <td>Session cookie (<code>axion_session</code>)</td>
            <td>Set on sign-in</td>
            <td>Keeping you signed in</td>
            <td>30 days</td>
          </tr>
          <tr>
            <td>Telemetry: game-owner Roblox id, licence key, Roblox universe id, Orbit version, time</td>
            <td>Sent by running Orbit builds</td>
            <td>Detecting misuse; knowing which versions run where</td>
            <td>30 days by default (admin-configurable), then deleted</td>
          </tr>
          <tr>
            <td>Security alarms (a key presented by the wrong user, unknown keys, unlicensed use)</td>
            <td>Derived from licence checks and telemetry</td>
            <td>Enforcing the License Agreement</td>
            <td>Until an admin clears them</td>
          </tr>
          <tr>
            <td>Activity log (sign-ins, downloads, licence changes, admin actions)</td>
            <td>Created by us</td>
            <td>Security and support</td>
            <td>Informational entries 24 hours; warnings until resolved</td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not store your Discord email, your Discord token, Roblox credentials or any payment
        details. Cloudflare, our hosting provider, sees IP addresses in transit and may keep them in
        its own short-lived logs under its terms; we do not record them ourselves.
      </p>

      <h2>3. Telemetry in detail</h2>
      <p>
        Every Orbit build calls our API when it starts and periodically while it runs. Each call
        carries the Roblox user id the build was licensed to, the licence key baked into it, the
        universe id of the experience it is running in, and the Orbit version string. It does not
        include player data, chat, or anything about the players in the experience. If the key does
        not belong to the user, or the user is not licensed, an alarm is recorded for our admins.
        The legal basis is our legitimate interest in enforcing the licence (Art. 6(1)(f) GDPR).
      </p>

      <h2>4. Third parties</h2>
      <ul>
        <li>
          <strong>Discord</strong> — sign-in. Discord's privacy policy applies to the sign-in step.
        </li>
        <li>
          <strong>Bloxlink</strong> — we send your Discord id and receive your Roblox id.
        </li>
        <li>
          <strong>Roblox</strong> — we may look up the public username for a Roblox id.
        </li>
        <li>
          <strong>Parcel</strong> — when you claim a Parcel purchase we send your Roblox id and
          receive whether you own the product there.
        </li>
        <li>
          <strong>nyxyl (Umbra)</strong> — the script source of your build, with your key inside,
          is sent for obfuscation when your download is generated. nyxyl states it does not store
          sources.
        </li>
        <li>
          <strong>Cloudflare</strong> — hosting, database and file storage.
        </li>
      </ul>
      <p>We do not sell data and do not use advertising or analytics trackers on the Site.</p>

      <h2>5. Your rights</h2>
      <p>
        You can ask for a copy of your data, a correction, or deletion. The quickest route is the{" "}
        <em>Request data deletion</em> button on your <Link to="/account">account page</Link>, which
        notifies an admin; deletion removes your account, sessions, licence, key, builds and
        telemetry. You may also contact us at <Placeholder what="contact email" /> and, if you are
        in the EU, complain to your supervisory authority (for Austria: the Datenschutzbehörde).
      </p>

      <h2>6. Changes</h2>
      <p>We will update the date above when this policy changes. Material changes will also be announced in our Discord.</p>
    </Doc>
  );
}
