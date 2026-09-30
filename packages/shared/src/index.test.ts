import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthSchema, LOCALES } from './index';

test('locales are en + ar', () => {
  assert.deepEqual([...LOCALES], ['en', 'ar']);
});

test('HealthSchema accepts a valid payload', () => {
  const r = HealthSchema.safeParse({
    status: 'ok',
    service: 'api',
    time: new Date().toISOString(),
  });
  assert.equal(r.success, true);
});
