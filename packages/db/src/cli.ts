import { connect } from './connection';
import { migrateDown, migrateUp, migrationStatus } from './migrate';
import { seed } from './seed';

async function main() {
  const cmd = process.argv[2];
  const client = await connect();
  try {
    switch (cmd) {
      case 'up': {
        const ran = await migrateUp(client);
        console.log(ran.length ? `applied: ${ran.join(', ')}` : 'up to date');
        break;
      }
      case 'down': {
        const steps = Number(process.argv[3] ?? 1);
        console.log(`reverted: ${(await migrateDown(client, steps)).join(', ') || 'nothing'}`);
        break;
      }
      case 'status':
        for (const s of await migrationStatus(client))
          console.log(`${s.applied ? '[x]' : '[ ]'} ${s.name}`);
        break;
      case 'seed':
        await seed(client);
        console.log('seeded');
        break;
      default:
        console.error('usage: cli.ts up | down [steps] | status | seed');
        process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
