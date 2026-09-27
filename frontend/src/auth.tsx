// Who is signed in, fetched once from /api/me and shared by every page.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Me } from "./api";

interface MeState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/api/me"));
    } catch {
      setMe({ user: null, discordConfigured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <MeContext.Provider value={{ me, loading, refresh, logout }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const state = useContext(MeContext);
  if (state === null) throw new Error("useMe outside MeProvider");
  return state;
}

// Where to send the browser to sign in, coming back to `returnTo` after.
export function loginUrl(returnTo = "/account"): string {
  return `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
}
