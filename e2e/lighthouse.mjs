// Lighthouse audit of key pages on a RUNNING stack (plan 7.4 / 10). Mobile emulation, throttled.
//   node lighthouse.mjs [baseUrl]      exit code 1 when a budget is missed
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const base = process.argv[2] ?? 'http://localhost:3000';
const RUNS = Number(process.env.LH_RUNS ?? 3);
const BUDGET = { performance: Number(process.env.LH_MIN_PERF ?? 0.9), // CI sets 0.85: shared runners inflate blocking time accessibility: 0.95, 'best-practices': 0.95, seo: 0.95 };

const search = await (await fetch(`${base}/api/v1/search?q=milk`)).json();
const pages = [
  '/en',
  '/ar',
  `/en/product/${search.results[0].id}`,
  `/ar/product/${search.results[0].id}`,
  '/en/offers',
];

const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-sandbox'],
});
let failed = 0;
for (const path of pages) {
  // Median of 3 runs: a single run on a shared CI runner is noisy (CPU starvation shows up as layout shift
  // and blocking time); the budgets themselves are unchanged.
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(
      (
        await lighthouse(`${base}${path}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: Object.keys(BUDGET),
        })
      ).lhr,
    );
  }
  const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const byScore = [...runs].sort(
    (x, y) => x.categories.performance.score - y.categories.performance.score,
  );
  const lhr = byScore[Math.floor(runs.length / 2)]; // the median-performance run is the one reported
  const scores = Object.fromEntries(
    Object.keys(BUDGET).map((k) => [k, median(runs.map((r) => r.categories[k].score))]),
  );
  const miss = Object.entries(BUDGET)
    .filter(([k, min]) => (scores[k] ?? 0) < min)
    .map(([k]) => k);
  const a = lhr.audits;
  console.log(
    `${miss.length ? 'FAIL' : 'ok  '} ${path.padEnd(48)} perf ${Math.round(scores.performance * 100)}  a11y ${Math.round(scores.accessibility * 100)}  bp ${Math.round(scores['best-practices'] * 100)}  seo ${Math.round(scores.seo * 100)}  LCP ${Math.round(a['largest-contentful-paint'].numericValue)}ms  CLS ${a['cumulative-layout-shift'].numericValue.toFixed(3)}  TBT ${Math.round(a['total-blocking-time'].numericValue)}ms`,
  );
  if (miss.length) {
    failed++;
    for (const it of a['layout-shifts']?.details?.items ?? [])
      console.log(`       - shift ${it.score?.toFixed(3)} ${it.node?.snippet?.slice(0, 140)}`);
    for (const k of miss) {
      const bad = Object.values(a).filter(
        (x) =>
          x.score !== null &&
          x.score < 0.9 &&
          lhr.categories[k].auditRefs.some((r) => r.id === x.id),
      );
      for (const x of bad.slice(0, 5)) console.log(`       - [${k}] ${x.id}: ${x.title}`);
    }
  }
}
await chrome.kill();
process.exit(failed ? 1 : 0);
