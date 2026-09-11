import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Database URL missing");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const migration = await client.query(`SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM "_prisma_migrations" WHERE migration_name = $1`, ["20260911000200_team_code_identity"]);
  const columns = await client.query(`SELECT table_name, column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('teams','submissions','import_batches','import_rows') ORDER BY table_name, ordinal_position`);
  const constraints = await client.query(`SELECT conrelid::regclass::text AS table_name, conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text IN ('teams','import_batches','import_rows') ORDER BY 1,2`);
  const indexes = await client.query(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('teams','import_batches','import_rows') ORDER BY 1,2`);
  const counts = await client.query(`SELECT (SELECT count(*)::int FROM events) AS events, (SELECT count(*)::int FROM rounds) AS rounds, (SELECT count(*)::int FROM round_rules) AS rules, (SELECT count(*)::int FROM questions) AS questions, (SELECT count(*)::int FROM admin_users) AS admins`);
  console.log(JSON.stringify({ migration: migration.rows, columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows, counts: counts.rows[0] }, null, 2));
} finally { await client.end(); }
