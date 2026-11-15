/** Apply drizzle/ migrations to DATABASE_URL. Usage: pnpm db:migrate */
import { connect, runMigrations } from "../src/server/db/connect";

const { db, pool } = connect();
try {
  await runMigrations(db);
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`Migrations applied (${host}).`);
} finally {
  await pool.end();
}
