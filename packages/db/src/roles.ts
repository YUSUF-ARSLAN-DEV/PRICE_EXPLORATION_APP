import type { Client } from 'pg';

export const ROLE_ENV: Record<string, string> = {
  qarib_api: 'QARIB_API_DB_PASSWORD',
  qarib_worker: 'QARIB_WORKER_DB_PASSWORD',
  qarib_readonly: 'QARIB_READONLY_DB_PASSWORD',
};

/**
 * Enables login for the least-privilege roles (migration 0011 creates them NOLOGIN) using passwords
 * from the environment (Key Vault -> container secret). A role without a password variable is left
 * NOLOGIN. Safe to re-run: it is how passwords are rotated. Returns the roles that were enabled.
 */
export async function setRolePasswords(
  client: Client,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const enabled: string[] = [];
  for (const [role, variable] of Object.entries(ROLE_ENV)) {
    const password = env[variable];
    if (!password) continue;
    if (password.length < 24) throw new Error(`${variable} must be at least 24 characters`);
    const stmt = await client.query<{ sql: string }>(
      `select format('alter role %I with login password %L', $1::text, $2::text) as sql`,
      [role, password],
    );
    await client.query(stmt.rows[0]!.sql); // password is quoted by format(%L); never logged
    enabled.push(role);
  }
  return enabled;
}
