const { Pool } = require('pg');
require('dotenv').config();

// Configure connection pool
let pool;
if (process.env.DATABASE_URL) {
  // Use connection string for Render/Supabase
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Supabase/Render connections
    }
  });
} else {
  // Fallback to individual credentials (local PostgreSQL testing)
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'subscription_db'
  });
}

// Helper to convert Oracle-style named binds (e.g. :id) to PG positional parameters (e.g. $1)
function convertNamedToPositional(sql, binds) {
  if (!binds || typeof binds !== 'object' || Array.isArray(binds)) {
    return { sql, binds };
  }

  let index = 1;
  const pgBinds = [];
  
  // Regex to find :name while avoiding double colons like :: (used for casting in Postgres)
  const pgSql = sql.replace(/:([a-zA-Z0-9_]+)/g, (match, name) => {
    if (binds[name] !== undefined) {
      pgBinds.push(binds[name]);
      return `$${index++}`;
    }
    return match;
  });

  return { sql: pgSql, binds: pgBinds };
}

/**
 * Execute an SQL query on the PostgreSQL Database.
 * Supports Oracle-style named binds and returns uppercase keys for server.js compatibility.
 */
async function executeQuery(sql, binds = {}, options = {}) {
  // 1. Convert named parameters to positional parameters
  const { sql: pgSql, binds: pgBinds } = convertNamedToPositional(sql, binds);

  try {
    const result = await pool.query(pgSql, pgBinds);

    // 2. Convert result row keys to UPPERCASE for server.js compatibility
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

    return {
      rows: uppercaseRows,
      rowsAffected: result.rowCount
    };
  } catch (err) {
    console.error('Database Query Error:', err);
    throw err;
  }
}

module.exports = {
  executeQuery
};
