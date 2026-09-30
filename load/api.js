// k6 load test (plan 10.3): search 200 req/s and product pages 50 req/s, p95 budgets from the plan.
//   docker run --rm -i -e API=http://host.docker.internal:4000 -e WEB=http://host.docker.internal:3000 \
//     grafana/k6 run - < load/api.js
import http from 'k6/http';
import { check } from 'k6';

const API = __ENV.API || 'http://localhost:4000';
const WEB = __ENV.WEB || 'http://localhost:3000';
const TERMS = [
  'milk',
  'rice',
  'eggs',
  'water',
  'حليب',
  'أرز',
  'DemoFarm',
  'mineral',
  'zzznotfound',
  'nadec milk',
  'almarai',
  'rice organic',
  'detergent family',
  'tea premium',
  'oil',
  'lulu coffee',
  'chips',
  'sugar extra',
];

export const options = {
  scenarios: {
    search: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '40s',
      preAllocatedVUs: 100,
      maxVUs: 300,
      exec: 'search',
    },
    product_pages: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '40s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'productPage',
      startTime: '0s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:search}': ['p(95)<300'], // plan: search p95 < 300 ms
    'http_req_duration{scenario:product_pages}': ['p(95)<1500'],
    'http_req_failed{scenario:search}': ['rate<0.001'],
    'http_req_failed{scenario:product_pages}': ['rate<0.005'],
  },
};

export function setup() {
  const res = http.get(`${API}/v1/search?q=milk`);
  return { ids: JSON.parse(res.body).results.map((r) => r.id) };
}

export function search() {
  const q = TERMS[Math.floor(Math.random() * TERMS.length)];
  const res = http.get(`${API}/v1/search?q=${encodeURIComponent(q)}`, { tags: { name: 'search' } });
  check(res, { 'search 200': (r) => r.status === 200 });
}

export function productPage(data) {
  const id = data.ids[Math.floor(Math.random() * data.ids.length)];
  const loc = Math.random() < 0.5 ? 'en' : 'ar';
  const res = http.get(`${WEB}/${loc}/product/${id}`, { tags: { name: 'product_page' } });
  check(res, { 'product 200': (r) => r.status === 200 });
}
