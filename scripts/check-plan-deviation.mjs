// Enforces plan.txt section 1.2: PRs touching sensitive paths must either
// update plan.txt or tick "No deviation from plan.txt" in the PR body.
// Usage (CI): PR_BODY="..." BASE_REF=origin/main node scripts/check-plan-deviation.mjs
import { execSync } from 'node:child_process';

const resolveBase = () => {
  const candidates = [process.env.BASE_REF, 'origin/main', 'origin/master', 'main', 'master'];
  for (const ref of candidates.filter(Boolean)) {
    try {
      execSync(`git rev-parse --verify --quiet ${ref}`, { stdio: 'ignore' });
      return ref;
    } catch {
      /* try next */
    }
  }
  return null;
};
const base = resolveBase();
if (!base) {
  console.log('plan-check: no base ref found, skipping.');
  process.exit(0);
}
const body = process.env.PR_BODY ?? '';
const SENSITIVE = [/^infra\//, /^services\/ingest\//, /migrations?\//, /^docker-compose\.yml$/];

const files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const sensitive = files.filter((f) => SENSITIVE.some((re) => re.test(f)));
if (sensitive.length === 0) {
  console.log('plan-check: no sensitive paths touched.');
  process.exit(0);
}

const planChanged = files.includes('plan.txt');
const noDeviation = /\[x\]\s*No deviation from plan\.txt/i.test(body);
const deviationLogged = /\[x\]\s*Deviates from plan\.txt/i.test(body);

if (planChanged || noDeviation) {
  console.log(`plan-check: OK (${planChanged ? 'plan.txt updated' : 'no-deviation ticked'}).`);
  process.exit(0);
}
console.error(
  'plan-check FAILED: sensitive files changed:\n  ' +
    sensitive.join('\n  ') +
    '\nEither update plan.txt (Change Log) or tick "No deviation from plan.txt" in the PR.' +
    (deviationLogged ? '\nYou ticked "Deviates" but plan.txt was not modified.' : ''),
);
process.exit(1);
