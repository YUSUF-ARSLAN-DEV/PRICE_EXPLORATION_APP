'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, clientFetch } from '../lib/api';
import { parseConsent, serializeConsent, type ConsentState } from '../lib/consent';
import type { Locale } from '../i18n';

// ---- session ---------------------------------------------------------------------------------
export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  locale: Locale;
}
interface SessionCtx {
  user: SessionUser | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}
const SessionContext = createContext<SessionCtx | null>(null);
export const useSession = () => {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUser((await clientFetch<{ user: SessionUser }>('/me')).user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        try {
          setUser(
            (await clientFetch<{ user: SessionUser }>('/auth/refresh', { method: 'POST' })).user,
          );
        } catch {
          setUser(null);
        }
      } else setUser(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionCtx>(
    () => ({
      user,
      ready,
      refresh,
      async login(email, password) {
        setUser(
          (
            await clientFetch<{ user: SessionUser }>('/auth/login', {
              method: 'POST',
              json: { email, password },
            })
          ).user,
        );
      },
      async logout() {
        await clientFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setUser(null);
      },
    }),
    [user, ready, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// ---- basket (device-only until the user saves it; no consent needed) ------------------------------
export interface BasketLine {
  id: string;
  name: string;
  quantity: number;
}
interface BasketCtx {
  lines: BasketLine[];
  add(line: { id: string; name: string }): void;
  remove(id: string): void;
  setQuantity(id: string, q: number): void;
  clear(): void;
  has(id: string): boolean;
  count: number;
}
const BasketContext = createContext<BasketCtx | null>(null);
export const useBasket = () => {
  const c = useContext(BasketContext);
  if (!c) throw new Error('useBasket outside BasketProvider');
  return c;
};
const KEY = 'qarib_basket';

export function BasketProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<BasketLine[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as BasketLine[];
      if (Array.isArray(raw))
        setLines(raw.filter((l) => l && typeof l.id === 'string' && l.quantity > 0));
    } catch {
      /* storage blocked or corrupt: start empty */
    }
  }, []);
  const save = useCallback((next: BasketLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: basket lives in memory only */
    }
  }, []);
  const value = useMemo<BasketCtx>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      has: (id) => lines.some((l) => l.id === id),
      add: (l) =>
        save(
          lines.some((x) => x.id === l.id)
            ? lines.map((x) =>
                x.id === l.id ? { ...x, quantity: Math.min(x.quantity + 1, 99) } : x,
              )
            : [...lines, { ...l, quantity: 1 }],
        ),
      remove: (id) => save(lines.filter((l) => l.id !== id)),
      setQuantity: (id, q) =>
        save(
          q <= 0
            ? lines.filter((l) => l.id !== id)
            : lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(q, 99) } : l)),
        ),
      clear: () => save([]),
    }),
    [lines, save],
  );
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

// ---- cookie consent ---------------------------------------------------------------------------
interface ConsentCtx {
  state: ConsentState | null; // null = not chosen yet
  settingsOpen: boolean;
  set(analytics: boolean): void;
  openSettings(): void;
  closeSettings(): void;
}
const ConsentContext = createContext<ConsentCtx | null>(null);
export const useConsent = () => {
  const c = useContext(ConsentContext);
  if (!c) throw new Error('useConsent outside ConsentProvider');
  return c;
};

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [settingsOpen, setOpen] = useState(false);
  useEffect(() => {
    setState(parseConsent(document.cookie));
  }, []);
  const value = useMemo<ConsentCtx>(
    () => ({
      state,
      settingsOpen,
      set(analytics) {
        const next: ConsentState = { analytics, version: 'v0.1', ts: Date.now() };
        document.cookie = serializeConsent(next, location.protocol === 'https:');
        setState(next);
        setOpen(false);
        // Keep the consent ledger on the server in sync for signed-in users (best effort).
        clientFetch('/me/consents', {
          method: 'PATCH',
          json: { consents: [{ purpose: 'analytics', granted: analytics }] },
        }).catch(() => undefined);
      },
      openSettings: () => setOpen(true),
      closeSettings: () => setOpen(false),
    }),
    [state, settingsOpen],
  );
  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
