import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Offer } from '@qarib/shared';
import { ar, en } from '../i18n';
import { CookieBanner, Header } from './chrome';
import { PriceChart, PriceTable } from './price';
import { BasketProvider, ConsentProvider, SessionProvider, useBasket } from './providers';
import { RegisterForm } from './actions';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/product/123' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/script', () => ({
  default: (p: { src: string }) => <script data-testid="analytics" src={p.src} />,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'qarib_consent=; Max-Age=0; Path=/';
  localStorage.clear();
});

const Providers = ({ children }: { children: ReactNode }) => (
  <SessionProvider>
    <BasketProvider>
      <ConsentProvider>{children}</ConsentProvider>
    </BasketProvider>
  </SessionProvider>
);

const offer = (over: Partial<Offer>): Offer => ({
  offer_id: over.retailer_slug ?? 'x',
  retailer_id: 'r',
  retailer_slug: 'a',
  retailer_name_en: 'Alpha Mart',
  retailer_name_ar: 'ألفا ماركت',
  branch_name: null,
  branch_area: null,
  price_qar: 6,
  was_price_qar: null,
  promo_type: 'none',
  promo_ends_at: null,
  in_stock: true,
  unit_price_qar: 6,
  unit_price_base: 'l',
  observed_at: '2026-10-05T09:00:00Z',
  is_stale: false,
  ...over,
});

describe('PriceTable', () => {
  const offers = [
    offer({ retailer_slug: 'a', price_qar: 5.5 }),
    offer({
      retailer_slug: 'b',
      retailer_name_en: 'Beta Hyper',
      retailer_name_ar: 'بيتا هايبر',
      price_qar: 7,
      was_price_qar: 9,
      is_stale: true,
    }),
  ];

  it('labels the cheapest store in text (not colour alone), shows discount, unit price and stale warning', () => {
    render(
      <PriceTable offers={offers} locale="en" dict={en} now={Date.parse('2026-10-05T12:00:00Z')} />,
    );
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByText('Cheapest')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('QAR 5.50')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/22% off/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('May be out of date')).toBeInTheDocument();
    expect(screen.getAllByText(/per L/).length).toBe(2);
    expect(screen.getAllByText('3 hours ago')).toHaveLength(2);
  });

  it('renders Arabic names and labels; table is properly structured for screen readers', () => {
    render(<PriceTable offers={offers} locale="ar" dict={ar} />);
    expect(screen.getByText('ألفا ماركت')).toBeInTheDocument();
    expect(screen.getByText('بيتا هايبر')).toBeInTheDocument();
    expect(screen.getByText('الأرخص')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.getByText('5.50 ر.ق')).toBeInTheDocument();
  });
});

describe('PriceChart', () => {
  it('has an accessible name, a legend, and a data-table alternative', () => {
    const history = [
      { retailer_slug: 'a', day: '2026-09-01', min_price_qar: 6 },
      { retailer_slug: 'a', day: '2026-09-09', min_price_qar: 5 },
    ];
    render(<PriceChart history={history} locale="en" dict={en} names={{ a: 'Alpha Mart' }} />);
    expect(screen.getByRole('img', { name: en.product.history })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Alpha Mart')).toBeInTheDocument(); // legend
    expect(screen.getByText(en.product.showData)).toBeInTheDocument();
  });

  it('shows a message instead of an empty chart', () => {
    render(<PriceChart history={[]} locale="en" dict={en} names={{}} />);
    expect(screen.getByText(en.product.noHistory)).toBeInTheDocument();
  });
});

describe('cookie banner (plan 7.6)', () => {
  it('appears on first visit with analytics NOT pre-ticked and no analytics script', () => {
    render(
      <Providers>
        <CookieBanner locale="en" dict={en} />
      </Providers>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-toggle')).not.toBeChecked();
    expect(screen.getByLabelText(en.cookies.necessary)).toBeDisabled();
    expect(document.cookie).not.toContain('qarib_consent');
    expect(screen.queryByTestId('analytics')).not.toBeInTheDocument();
  });

  it('"only necessary" stores a rejection and closes; choice persists in a cookie', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <CookieBanner locale="en" dict={en} />
      </Providers>,
    );
    await user.click(screen.getByRole('button', { name: en.cookies.rejectAll }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(decodeURIComponent(document.cookie)).toContain('"analytics":false');
  });

  it('accepting stores consent version + timestamp', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <CookieBanner locale="en" dict={en} />
      </Providers>,
    );
    await user.click(screen.getByRole('button', { name: en.cookies.acceptAll }));
    const stored = JSON.parse(
      decodeURIComponent(/qarib_consent=([^;]+)/.exec(document.cookie)![1]!),
    );
    expect(stored).toMatchObject({ analytics: true, version: 'v0.1' });
    expect(typeof stored.ts).toBe('number');
  });

  it('stays hidden on later visits when a choice exists', () => {
    document.cookie = `qarib_consent=${encodeURIComponent(JSON.stringify({ analytics: false, version: 'v0.1', ts: 1 }))}; Path=/`;
    render(
      <Providers>
        <CookieBanner locale="en" dict={en} />
      </Providers>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Header', () => {
  it('offers the other language, preserving the current page', () => {
    render(
      <Providers>
        <Header locale="en" dict={en} />
      </Providers>,
    );
    const link = screen.getByRole('link', { name: en.nav.languageLabel });
    expect(link).toHaveAttribute('href', '/ar/product/123');
    expect(link).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('basket (device-only)', () => {
  function Probe() {
    const b = useBasket();
    return (
      <div>
        <button onClick={() => b.add({ id: 'p1', name: 'Milk' })}>add</button>
        <button onClick={() => b.setQuantity('p1', 0)}>zero</button>
        <span data-testid="count">{b.count}</span>
      </div>
    );
  }

  it('adds, increments, persists to localStorage and removes at quantity 0', async () => {
    const user = userEvent.setup();
    render(
      <BasketProvider>
        <Probe />
      </BasketProvider>,
    );
    await user.click(screen.getByText('add'));
    await user.click(screen.getByText('add'));
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(JSON.parse(localStorage.getItem('qarib_basket')!)).toEqual([
      { id: 'p1', name: 'Milk', quantity: 2 },
    ]);
    await user.click(screen.getByText('zero'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('ignores corrupt storage instead of crashing', () => {
    localStorage.setItem('qarib_basket', '{oops');
    render(
      <BasketProvider>
        <Probe />
      </BasketProvider>,
    );
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});

describe('RegisterForm', () => {
  it('terms consent is required and never pre-ticked; fields have labels and autocomplete hints', () => {
    render(
      <Providers>
        <RegisterForm locale="en" dict={en} />
      </Providers>,
    );
    const terms = screen.getByRole('checkbox');
    expect(terms).not.toBeChecked();
    expect(terms).toBeRequired();
    expect(screen.getByLabelText(en.account.email)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(en.account.password)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.getByLabelText(en.account.password)).toHaveAttribute('minlength', '10');
  });

  it('sends the chosen language and acceptTerms to the API', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/auth/register')
          ? new Response(JSON.stringify({ message: 'ok' }), { status: 202 })
          : new Response('{}', { status: 401 }),
      ),
    );
    render(
      <Providers>
        <RegisterForm locale="ar" dict={ar} />
      </Providers>,
    );
    await user.type(screen.getByLabelText(ar.account.email), 'a@example.com');
    await user.type(screen.getByLabelText(ar.account.password), 'correct-horse-9');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: ar.account.register }));
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/auth/register'))!;
    expect(JSON.parse(call[1].body)).toMatchObject({
      email: 'a@example.com',
      locale: 'ar',
      acceptTerms: true,
    });
    expect(new Headers(call[1].headers).get('x-qarib-csrf')).toBe('1');
    expect(await screen.findByText(ar.account.registered)).toBeInTheDocument();
  });
});
