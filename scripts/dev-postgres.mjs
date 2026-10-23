/**
 * Optional local PostgreSQL launcher (no Docker needed).
 *   node scripts/dev-postgres.mjs start   -> init (first run) + start in foreground
 *   node scripts/dev-postgres.mjs stop    -> terminate a `start` run on this machine
 *   node scripts/dev-postgres.mjs status  -> is port 5432 serving?
 * Data lives in ./data/postgres (gitignored). Overrides: PG_PORT, PG_DATA_DIR.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import net from 'net';
import path from 'path';

const port = Number(process.env.PG_PORT ?? 5432);
const dataDir = process.env.PG_DATA_DIR ?? path.resolve('./data/postgres');
const pidFile = path.resolve('./data/postgres.pid');
const command = process.argv[2] ?? 'start';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: process.env.PGUSER ?? 'pintoria',
  password: process.env.PGPASSWORD ?? 'pintoria',
  port,
});

function waitPortOpen(ms = 30000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const attempt = () => {
      if (Date.now() >= deadline) return resolve(false);
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(attempt, 300);
      });
      socket.setTimeout(400, () => {
        socket.destroy();
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function start() {
  if (await waitPortOpen(2000)) {
    console.log(`Postgres already serving on port ${port}.`);
    return;
  }
  mkdirSync(path.dirname(dataDir), { recursive: true });
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('Initialising data directory (first run)...');
    await pg.initialise();
  }
  console.log(`Starting PostgreSQL on ${port} (data: ${dataDir})...`);
  await pg.start();
  writeFileSync(pidFile, String(process.pid));
  console.log('PostgreSQL is up. Creating pintoria_dev / pintoria_test if missing...');
  for (const db of ['pintoria_dev', 'pintoria_test']) {
    try {
      await pg.createDatabase(db);
      console.log(`created ${db}`);
    } catch {
      /* already exists */
    }
  }
  console.log('Press Ctrl+C to stop.');
  await new Promise(() => {}); // stay alive
}

async function stop() {
  if (!existsSync(pidFile)) {
    console.log('No pid file found.');
    process.exit(0);
  }
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent stop signal to ${pid}.`);
  } catch {
    console.log(`Process ${pid} not running.`);
  }
  process.exit(0);
}

async function status() {
  const up = await waitPortOpen(1500);
  console.log(up ? `Postgres is UP on port ${port}.` : `Postgres is DOWN on port ${port}.`);
  process.exit(up ? 0 : 1);
}

if (command === 'start') await start();
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else {
  console.error('Unknown command. Use start | stop | status.');
  process.exit(1);
}
