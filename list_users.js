const { executeQuery } = require('./db');
require('dotenv').config();

async function run() {
  try {
    const result = await executeQuery('SELECT id, username, ad FROM istifadeciler ORDER BY id DESC LIMIT 10');
    console.log('Son 10 istifadeci:');
    console.table(result.rows);
  } catch (err) {
    console.error('Xeta:', err.message);
  }
  process.exit(0);
}
run();
