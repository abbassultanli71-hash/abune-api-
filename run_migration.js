const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await pool.query(`
      ALTER TABLE abunelikler 
      ADD COLUMN IF NOT EXISTS odenis_metodu_id INTEGER REFERENCES odenis_metodlari(id) ON DELETE SET NULL;
    `);
    console.log('Successfully altered table abunelikler.');
  } catch (err) {
    console.error('Error running migration:', err);
  } finally {
    await pool.end();
  }
}

main();
