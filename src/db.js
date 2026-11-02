const fs = require('fs');
const path = require('path');

// Múi giờ Việt Nam: server Render chạy UTC nên "hôm nay" phải tính theo giờ VN
const TODAY = "(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date";

let impl = null;

// DATE trả về dạng chuỗi 'YYYY-MM-DD' để tránh lệch múi giờ khi parse
const DATE_OID = 1082;

async function init() {
  if (impl) return impl;
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool, types } = require('pg');
    types.setTypeParser(DATE_OID, (v) => v);
    // Kết nối external của Render (…render.com) bắt buộc SSL; internal URL thì không
    const useSsl = process.env.PGSSL ? process.env.PGSSL !== 'false' : /render\.com/.test(url);
    const pool = new Pool({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : false });
    impl = {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (s, p) => client.query(s, p) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    // Chạy cục bộ không cần cài PostgreSQL: dùng PGlite (PostgreSQL biên dịch sang WASM)
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite({ dataDir: process.env.PGLITE_DIR, parsers: { [DATE_OID]: (v) => v } });
    await db.waitReady;
    impl = {
      kind: 'pglite',
      query: (sql, params) => db.query(sql, params),
      tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
      exec: (sql) => db.exec(sql), // PGlite chỉ cho phép nhiều câu lệnh qua exec()
      close: () => db.close(),
    };
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await (impl.exec ? impl.exec(schema) : impl.query(schema));
  return impl;
}

function get() {
  if (!impl) throw new Error('Database chưa được khởi tạo');
  return impl;
}

module.exports = { init, get, TODAY };
