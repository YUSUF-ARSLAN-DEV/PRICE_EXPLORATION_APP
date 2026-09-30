/** Cookie-consent storage (plan 7.6). The consent cookie is itself strictly necessary. */
export interface ConsentState {
  analytics: boolean;
  version: string;
  ts: number;
}
export const CONSENT_COOKIE = 'qarib_consent';

export function parseConsent(cookieHeader: string): ConsentState | null {
  const m = new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]+)`).exec(cookieHeader);
  if (!m?.[1]) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1])) as Partial<ConsentState>;
    if (
      typeof v.analytics !== 'boolean' ||
      typeof v.version !== 'string' ||
      typeof v.ts !== 'number'
    )
      return null;
    return { analytics: v.analytics, version: v.version, ts: v.ts };
  } catch {
    return null;
  }
}

export function serializeConsent(state: ConsentState, secure: boolean): string {
  const maxAge = 60 * 60 * 24 * 365;
  return `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
