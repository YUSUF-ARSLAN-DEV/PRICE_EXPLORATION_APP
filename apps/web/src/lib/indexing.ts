/**
 * Search-engine visibility switch (plan 10.6). During the soft launch the site runs on the production stack
 * but must not be indexed: set SITE_INDEXING=off. Read at request time (not build time), so flipping it
 * is a configuration change, not a rebuild.
 */
export function indexingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.SITE_INDEXING ?? 'on').toLowerCase() !== 'off';
}
