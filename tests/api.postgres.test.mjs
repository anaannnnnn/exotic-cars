import { PGlite } from '@electric-sql/pglite';
import { apiSuite } from './api-suite.mjs';

/* The API on Postgres, as on Vercel with Neon: the same suite against PGlite (Postgres compiled to WebAssembly). */
let db;
apiSuite('Postgres', {
  async start() {
    db = new PGlite();
    await db.query('select 1');   /* the engine starts slowly the first time: warm it before the timed tests */
    const { useSqlStore } = await import('../server/store.mjs');
    useSqlStore(async (text, params) => {
      const r = await db.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    });
  },
  async stop() { await db?.close(); }
});
