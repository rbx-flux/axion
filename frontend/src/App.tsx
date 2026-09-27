// Layout and routes. The Worker serves index.html for every path it does
// not know (`not_found_handling: "single-page-application"`), so unknown
// paths land here and get the not-found view.

import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { loginUrl, useMe } from "./auth";
import { Account } from "./pages/Account";
import { Home } from "./pages/Home";
import { Privacy, Terms } from "./pages/Legal";
import { Login } from "./pages/Login";
import { NotFound } from "./pages/NotFound";
import { Admin } from "./pages/admin/Admin";
import { Icon, Mark, Spinner } from "./ui";

export const DOCS_URL = "https://docs.orbitroblox.xyz";
export const LICENSE_AGREEMENT_URL = "https://docs.orbitroblox.xyz/license-agreement";
export const DISCORD_URL = "/discord";
export const GITHUB_URL = "/github";

export function App() {
  return (
    <div className="shell">
      <Header />
      <main className="page" id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<Account />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/admin/*" element={<RequireAdmin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const { me, loading } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location]);

  const user = me?.user ?? null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Orbit home">
          <Mark size={28} />
          <span>Orbit</span>
        </Link>
        <button className="nav-toggle" aria-expanded={open} aria-controls="nav" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "x" : "menu"} size={18} />
          <span className="sr-only">Menu</span>
        </button>
        <nav id="nav" className={`nav ${open ? "open" : ""}`} aria-label="Primary">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Docs <Icon name="external" size={12} />
          </a>
          <a href={DISCORD_URL} target="_blank" rel="noreferrer">
            Discord
          </a>
          {user?.moderator && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              {user.admin ? "Admin" : "Moderation"}
            </NavLink>
          )}
          {loading ? null : user ? (
            <NavLink to="/account" className={({ isActive }) => `nav-user ${isActive ? "active" : ""}`}>
              {user.avatar ? <img src={user.avatar} alt="" width={20} height={20} /> : <Icon name="user" />}
              <span>{user.username}</span>
            </NavLink>
          ) : (
            <a href={loginUrl()} className="btn btn-primary btn-sm">
              <Icon name="discord" />
              <span>Sign in</span>
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p className="footer-brand">
          <Mark size={16} /> Orbit · a flux studio product
        </p>
        <nav aria-label="Legal and links" className="footer-links">
          <Link to="/terms">Terms of Service</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <a href={LICENSE_AGREEMENT_URL} target="_blank" rel="noreferrer">
            License Agreement
          </a>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

function RequireAdmin() {
  const { me, loading } = useMe();
  if (loading) return <Spinner />;
  if (!me?.user) return <Navigate to={`/login?next=${encodeURIComponent("/admin")}`} replace />;
  if (!me.user.moderator) return <NotFound />;
  return <Admin admin={me.user.admin} />;
}
