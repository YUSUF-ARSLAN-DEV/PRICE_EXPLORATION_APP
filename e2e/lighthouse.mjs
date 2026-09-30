// Lighthouse audit of key pages on a RUNNING stack (plan 7.4 / 10). Mobile emulation, throttled.
//   node lighthouse.mjs [baseUrl]      exit code 1 when a budget is missed
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const base = process.argv[2] ?? 'http://localhost:3000';
const BUDGET = { performance: 0.9, accessibility: 0.95, 'best-practices': 0.95, seo: 0.95 };

const search = await (await fetch(`${base}/api/v1/search?q=milk`)).json();
const pages = ['/en', '/ar', `/en/product/${search.results[0].id}`, `/ar/product/${search.results[0].id}`, '/en/offers'];

const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
let failed = 0;
for (const path of pages) {
  const { lhr } = await lighthouse(`${base}${path}`, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: Object.keys(BUDGET) });
  const scores = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v.score]));
  const miss = Object.entries(BUDGET).filter(([k, min]) => (scores[k] ?? 0) < min).map(([k]) => k);
  const a = lhr.audits;
  console.log(
    `${miss.length ? 'FAIL' : 'ok  '} ${path.padEnd(48)} perf ${Math.round(scores.performance * 100)}  a11y ${Math.round(scores.accessibility * 100)}  bp ${Math.round(scores['best-practices'] * 100)}  seo ${Math.round(scores.seo * 100)}  LCP ${Math.round(a['largest-contentful-paint'].numericValue)}ms  CLS ${a['cumulative-layout-shift'].numericValue.toFixed(3)}  TBT ${Math.round(a['total-blocking-time'].numericValue)}ms`,
  );
  if (miss.length) {
    failed++;
    for (const k of miss) {
      const bad = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && lhr.categories[k].auditRefs.some((r) => r.id === x.id));
      for (const x of bad.slice(0, 5)) console.log(`       - [${k}] ${x.id}: ${x.title}`);
    }
  }
}
await chrome.kill();
process.exit(failed ? 1 : 0);
