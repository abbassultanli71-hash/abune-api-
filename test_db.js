const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'abunelikler';
    `);
    console.log('abunelikler columns:', res.rows.map(r => r.column_name));

    const res2 = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'odenis_metodlari';
    `);
    console.log('odenis_metodlari columns:', res2.rows.map(r => r.column_name));
  } catch (err) {
    console.error('Error running query:', err);
  } finally {
    await pool.end();
  }
}

main();
