import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Return SQLite-like plain values so the rest of the app stays simple:
//  - int8/numeric come back as numbers, not strings
//  - date / timestamp come back as 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS' strings
pg.types.setTypeParser(20, v => Number(v));        // int8 (COUNT etc.)
pg.types.setTypeParser(1700, v => Number(v));      // numeric (ROUND, SUM)
pg.types.setTypeParser(700, v => Number(v));       // float4
pg.types.setTypeParser(701, v => Number(v));       // float8
pg.types.setTypeParser(1082, v => v);              // date
pg.types.setTypeParser(1114, v => v);              // timestamp
pg.types.setTypeParser(1184, v => v);              // timestamptz

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://postgres:postgres@localhost:5432/rsgroup';

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_SIZE || 10),
  // Supabase (and most hosted Postgres) require TLS; local dev does not.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // App tables live in the dedicated "rsgroup" schema (see schema.sql).
  options: '-c search_path=rsgroup,public',
});

// Belt and braces: some connection poolers drop startup options.
pool.on('connect', client => {
  client.query('SET search_path TO rsgroup, public').catch(() => {});
});

// Convert `?` placeholders to $1..$n so queries read the same as before.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function helpers(runner) {
  const query = async (sql, params = []) => {
    const res = await runner.query(toPg(sql), params);
    return res;
  };
  return {
    all: async (sql, ...params) => (await query(sql, params)).rows,
    get: async (sql, ...params) => (await query(sql, params)).rows[0],
    run: async (sql, ...params) => {
      const res = await query(sql, params);
      return { changes: res.rowCount, rows: res.rows };
    },
    // INSERT ... RETURNING id convenience
    insert: async (sql, ...params) => {
      const res = await query(sql.includes('RETURNING') ? sql : `${sql} RETURNING id`, params);
      return res.rows[0]?.id;
    },
  };
}

const base = helpers(pool);
export const all = base.all;
export const get = base.get;
export const run = base.run;
export const insert = base.insert;

// Transaction: callback receives the same helper API bound to one connection.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(helpers(client));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

export default { all, get, run, insert, tx, pool, initSchema };
