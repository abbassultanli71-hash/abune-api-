const { Pool } = require('pg');
require('dotenv').config();

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    options: '-c timezone=Asia/Baku'
  });
} else {
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'subscription_db',
    options: '-c timezone=Asia/Baku'
  });
}

function convertNamedToPositional(sql, binds) {
  if (!binds || typeof binds !== 'object' || Array.isArray(binds)) {
    return { sql, binds };
  }
  let index = 1;
  const pgBinds = [];
  const pgSql = sql.replace(/:([a-zA-Z0-9_]+)/g, (match, name) => {
    if (binds[name] !== undefined) {
      pgBinds.push(binds[name]);
      return `$${index++}`;
    }
    return match;
  });
  return { sql: pgSql, binds: pgBinds };
}

async function executeQuery(sql, binds = {}, options = {}) {
  const { sql: pgSql, binds: pgBinds } = convertNamedToPositional(sql, binds);
  try {
    const result = await pool.query(pgSql, pgBinds);
    let uppercaseRows = [];
    if (result.rows && result.rows.length > 0) {
      uppercaseRows = result.rows.map(row => {
        const uppercaseRow = {};
        for (const key of Object.keys(row)) {
          uppercaseRow[key.toUpperCase()] = row[key];
        }
        return uppercaseRow;
      });
    }
    return { rows: uppercaseRows, rowsAffected: result.rowCount };
  } catch (err) {
    console.error('Database Query Error:', err);
    throw err;
  }
}

module.exports = { executeQuery };
