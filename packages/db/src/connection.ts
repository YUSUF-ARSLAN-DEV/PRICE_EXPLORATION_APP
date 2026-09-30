import { Client } from 'pg';

export const DEFAULT_DATABASE_URL = 'postgresql://qarib:qarib_local_only@localhost:5432/qarib';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export async function connect(url = databaseUrl()): Promise<Client> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  return client;
}
