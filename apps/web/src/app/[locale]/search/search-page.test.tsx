import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/en/search',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../../components/chrome', () => ({
  SearchBox: ({ initial }: { initial?: string }) => <input aria-label="q" defaultValue={initial} />,
}));

import SearchPage from './page';

const payload = {
  query: 'milk',
  backend: 'postgres',
  total: 1,
  disclaimer: 'Check at the store.',
  results: [
    {
      id: 'p1',
      name_en: 'Fresh Milk',
      name_ar: null,
      brand: 'DemoFarm',
      category_slug: null,
      size_value: 1,
      size_unit: 'l',
      pack_count: 1,
      offers: [{ unit_price_qar: 6.5, unit_price_base: 'l' }],
      offer_count: 2,
      min_price_qar: 6.5,
      max_price_qar: 7,
      last_updated: null,
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

async function renderPage(searchParams: Record<string, string | string[]>) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const ui = await SearchPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(searchParams),
  });
  render(ui);
  return fetchMock;
}

describe('search page robustness (found by the ZAP baseline scan)', () => {
  it('renders results for a normal query', async () => {
    await renderPage({ q: 'milk' });
    expect(screen.getByText('Fresh Milk')).toBeInTheDocument();
    expect(screen.getByText('QAR 6.50')).toBeInTheDocument();
  });

  it('does not crash on repeated query parameters (?q=a&q=b) - uses the first value', async () => {
    const fetchMock = await renderPage({
      q: ['Dairy & Eggs', 'Dairy+&+Eggs'],
      sort: ['price', 'unit_price'],
    });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('q=Dairy%20%26%20Eggs');
    expect(url).toContain('sort=price');
  });

  it('ignores unknown sort values and redirects home when there is no query', async () => {
    const fetchMock = await renderPage({ q: 'milk', sort: 'DROP TABLE' });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('sort=relevance');
    await expect(
      SearchPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ q: [] }),
      }),
    ).rejects.toThrow('REDIRECT:/en');
    await expect(
      SearchPage({
        params: Promise.resolve({ locale: 'fr' }),
        searchParams: Promise.resolve({ q: 'x' }),
      }),
    ).rejects.toThrow('NOT_FOUND');
  });
});
