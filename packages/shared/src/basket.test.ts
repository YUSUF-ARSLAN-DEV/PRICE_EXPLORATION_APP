import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimiseBasket, type OfferPrice } from './basket';

const o = (product_id: string, retailer_id: string, price_qar: number): OfferPrice => ({
  product_id,
  retailer_id,
  retailer_slug: retailer_id,
  retailer_name_en: retailer_id.toUpperCase(),
  price_qar,
});

// milk: A 6, B 5 | rice: A 30, B 32 | eggs: only A 10
const OFFERS = [
  o('milk', 'a', 6),
  o('milk', 'b', 5),
  o('rice', 'a', 30),
  o('rice', 'b', 32),
  o('eggs', 'a', 10),
];

test('per-store totals and best single store (fewest missing first)', () => {
  const plan = optimiseBasket(
    [
      { product_id: 'milk', quantity: 2 },
      { product_id: 'rice', quantity: 1 },
      { product_id: 'eggs', quantity: 1 },
    ],
    OFFERS,
  );
  assert.equal(plan.stores[0]!.retailer_id, 'a');
  assert.equal(plan.stores[0]!.total_qar, 52); // 12 + 30 + 10
  assert.deepEqual(plan.best_single, { retailer_id: 'a', total_qar: 52, missing_product_ids: [] });
  const b = plan.stores.find((s) => s.retailer_id === 'b')!;
  assert.equal(b.items, 2);
  assert.equal(b.total_qar, 42); // 10 + 32, eggs missing
});

test('split across two stores is suggested when it is cheaper than the best full-cover store', () => {
  const plan = optimiseBasket(
    [
      { product_id: 'milk', quantity: 10 },
      { product_id: 'rice', quantity: 1 },
    ],
    OFFERS,
  );
  // single A = 60+30 = 90 ; single B = 50+32 = 82 ; split: milk@B 50 + rice@A 30 = 80
  assert.ok(plan.best_split);
  assert.equal(plan.best_split!.total_qar, 80);
  const byProduct = Object.fromEntries(
    plan.best_split!.assignments.map((a) => [a.product_id, a.retailer_id]),
  );
  assert.deepEqual(byProduct, { milk: 'b', rice: 'a' });
});

test('per-store penalty suppresses a marginal split', () => {
  const items = [
    { product_id: 'milk', quantity: 10 },
    { product_id: 'rice', quantity: 1 },
  ];
  assert.ok(optimiseBasket(items, OFFERS, { split_penalty_qar: 1 }).best_split);
  assert.equal(optimiseBasket(items, OFFERS, { split_penalty_qar: 5 }).best_split, null);
  assert.equal(optimiseBasket(items, OFFERS, { allow_split: false }).best_split, null);
});

test('products nobody sells are reported and do not break the plan', () => {
  const plan = optimiseBasket(
    [
      { product_id: 'milk', quantity: 1 },
      { product_id: 'caviar', quantity: 1 },
    ],
    OFFERS,
  );
  assert.deepEqual(plan.unavailable_product_ids, ['caviar']);
  assert.equal(plan.best_single!.retailer_id, 'b');
  assert.equal(plan.best_single!.total_qar, 5);
});

test('duplicate lines are merged, cheapest duplicate offer wins, empty input is safe', () => {
  const plan = optimiseBasket(
    [
      { product_id: 'milk', quantity: 1 },
      { product_id: 'milk', quantity: 2 },
    ],
    [...OFFERS, o('milk', 'a', 4.5)],
  );
  assert.equal(plan.stores.find((s) => s.retailer_id === 'a')!.total_qar, 13.5);
  const empty = optimiseBasket([{ product_id: 'x', quantity: 1 }], []);
  assert.equal(empty.best_single, null);
  assert.deepEqual(empty.unavailable_product_ids, ['x']);
});

test('money is computed in integer cents (no float drift)', () => {
  const plan = optimiseBasket(
    [{ product_id: 'p', quantity: 3 }],
    [o('p', 'a', 0.1), o('p', 'b', 0.2)],
  );
  assert.equal(plan.best_single!.total_qar, 0.3);
});
