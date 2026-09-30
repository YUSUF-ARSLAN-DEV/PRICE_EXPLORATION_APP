/**
 * Basket optimiser (plan 5.5): pure function, no I/O, no personal data.
 *
 * Given the cheapest price per (product, retailer) it returns each retailer's basket total, the
 * best single store, and the best split across at most two stores (optionally penalised per extra
 * store so a tiny saving does not send people to two shops).
 */
import type { BasketPlan } from './api';

export interface OfferPrice {
  product_id: string;
  retailer_id: string;
  retailer_slug: string;
  retailer_name_en: string;
  price_qar: number;
}
export interface BasketLine {
  product_id: string;
  quantity: number;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

export function optimiseBasket(
  items: BasketLine[],
  offers: OfferPrice[],
  opts: { allow_split?: boolean; split_penalty_qar?: number } = {},
): BasketPlan {
  const allowSplit = opts.allow_split ?? true;
  const penalty = cents(opts.split_penalty_qar ?? 0);

  // cheapest price for each product at each retailer, in cents
  const price = new Map<string, Map<string, number>>(); // retailer -> product -> cents
  const meta = new Map<string, { slug: string; name: string }>();
  for (const o of offers) {
    meta.set(o.retailer_id, { slug: o.retailer_slug, name: o.retailer_name_en });
    const m = price.get(o.retailer_id) ?? new Map<string, number>();
    const c = cents(o.price_qar);
    if (!m.has(o.product_id) || c < m.get(o.product_id)!) m.set(o.product_id, c);
    price.set(o.retailer_id, m);
  }

  // merge duplicate lines
  const qty = new Map<string, number>();
  for (const it of items) qty.set(it.product_id, (qty.get(it.product_id) ?? 0) + it.quantity);

  const available = new Set<string>();
  for (const m of price.values()) for (const p of m.keys()) if (qty.has(p)) available.add(p);
  const unavailable = [...qty.keys()].filter((p) => !available.has(p));
  const wanted = [...available];

  const retailers = [...price.keys()];
  const stores = retailers
    .map((r) => {
      const m = price.get(r)!;
      let total = 0;
      let n = 0;
      for (const p of wanted) {
        const c = m.get(p);
        if (c !== undefined) {
          total += Math.round(c * qty.get(p)!);
          n++;
        }
      }
      return {
        retailer_id: r,
        retailer_slug: meta.get(r)!.slug,
        retailer_name_en: meta.get(r)!.name,
        total_qar: money(total),
        items: n,
        _total: total,
      };
    })
    .filter((s) => s.items > 0)
    .sort((a, b) => b.items - a.items || a._total - b._total);

  // best single store: fewest missing items first, then cheapest
  const top = stores[0];
  const best_single = top
    ? {
        retailer_id: top.retailer_id,
        total_qar: top.total_qar,
        missing_product_ids: wanted.filter((p) => !price.get(top.retailer_id)!.has(p)),
      }
    : null;

  let best_split: BasketPlan['best_split'] = null;
  if (allowSplit && wanted.length > 1 && retailers.length > 1) {
    let bestScore = Infinity;
    for (let i = 0; i < retailers.length; i++) {
      for (let j = i + 1; j < retailers.length; j++) {
        const a = price.get(retailers[i]!)!;
        const b = price.get(retailers[j]!)!;
        let total = 0;
        let covers = true;
        let usesA = false;
        let usesB = false;
        const assign: {
          product_id: string;
          retailer_id: string;
          price_qar: number;
          quantity: number;
        }[] = [];
        for (const p of wanted) {
          const ca = a.get(p);
          const cb = b.get(p);
          if (ca === undefined && cb === undefined) {
            covers = false;
            break;
          }
          const useA = cb === undefined || (ca !== undefined && ca <= cb);
          const c = useA ? ca! : cb!;
          if (useA) usesA = true;
          else usesB = true;
          total += Math.round(c * qty.get(p)!);
          assign.push({
            product_id: p,
            retailer_id: useA ? retailers[i]! : retailers[j]!,
            price_qar: money(c),
            quantity: qty.get(p)!,
          });
        }
        if (!covers || !usesA || !usesB) continue; // a real split uses both stores
        const score = total + penalty;
        if (score < bestScore) {
          bestScore = score;
          best_split = {
            total_qar: money(total),
            penalty_qar: money(penalty),
            assignments: assign,
          };
        }
      }
    }
    // only worth suggesting if it beats the best store that covers EVERYTHING
    const fullCover = stores.find((s) => s.items === wanted.length);
    if (best_split && fullCover && cents(best_split.total_qar) + penalty >= fullCover._total)
      best_split = null;
  }

  return {
    stores: stores.map(({ _total, ...s }) => s),
    best_single,
    best_split,
    unavailable_product_ids: unavailable,
  };
}
