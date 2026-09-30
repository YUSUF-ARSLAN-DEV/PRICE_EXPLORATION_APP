import type { ProductResult, SearchResponse } from '@qarib/shared';

/** Server components talk to the API directly; browsers go through the same-origin /api rewrite. */
const SERVER_BASE = process.env.API_URL ?? 'http://localhost:4000/v1';
export const CLIENT_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch for server components (public, cacheable data only - never user data). */
export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, { next: { revalidate } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // API down: pages render an empty state instead of crashing
  }
}

/** Fetch for client components: same-origin, cookies included, CSRF header on mutations. */
export async function clientFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-qarib-csrf', '1');
  const res = await fetch(`${CLIENT_BASE}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.code as string | undefined,
      (data.detail as string) ?? res.statusText,
    );
  }
  return data as T;
}

export const searchProducts = (q: string, sort = 'relevance', lang = 'en') =>
  serverGet<SearchResponse>(
    `/search?q=${encodeURIComponent(q)}&sort=${sort}&lang=${lang}&limit=30`,
    30,
  );

export type ProductPage = {
  product: ProductResult;
  history: { retailer_slug: string; day: string; min_price_qar: number }[];
  disclaimer: string;
};
export const getProduct = (id: string) => serverGet<ProductPage>(`/products/${id}`, 60);
