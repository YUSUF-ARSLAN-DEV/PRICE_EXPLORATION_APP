import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeSearch, parseSize, toNfc } from './index';

const fixtures = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, '../fixtures', name), 'utf8')) as {
    input: string;
    expected: unknown;
  }[];

test('normalizeSearch matches the shared Arabic fixtures', () => {
  const cases = fixtures('arabic-cases.json');
  assert.ok(cases.length >= 25);
  for (const c of cases) {
    assert.equal(normalizeSearch(c.input), c.expected, `input: ${JSON.stringify(c.input)}`);
  }
});

test('normalizeSearch is idempotent', () => {
  for (const c of fixtures('arabic-cases.json')) {
    const once = normalizeSearch(c.input);
    assert.equal(normalizeSearch(once), once);
  }
});

test('toNfc composes decomposed text but keeps diacritics', () => {
  assert.equal(toNfc('é'), 'é');
  assert.equal(toNfc('مَاء'), 'مَاء');
});

interface Expected {
  size_value: number;
  size_unit: string;
  pack_count: number;
  base_quantity: number;
  base_unit: string;
}

test('parseSize matches the >=200 shared size fixtures', () => {
  const cases = fixtures('size-cases.json') as { input: string; expected: Expected | null }[];
  assert.ok(cases.length >= 200, `only ${cases.length} cases`);
  for (const c of cases) {
    const got = parseSize(c.input);
    const ctx = `input: ${JSON.stringify(c.input)}`;
    if (c.expected === null) {
      assert.equal(got, null, ctx);
      continue;
    }
    assert.ok(got, ctx);
    assert.equal(got.size_unit, c.expected.size_unit, ctx);
    assert.equal(got.pack_count, c.expected.pack_count, ctx);
    assert.equal(got.base_unit, c.expected.base_unit, ctx);
    assert.ok(Math.abs(got.size_value - c.expected.size_value) < 1e-6, ctx);
    assert.ok(Math.abs(got.base_quantity - c.expected.base_quantity) < 1e-6, ctx);
  }
});
