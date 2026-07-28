const { executeQuery } = require('../db');

async function main() {
  console.log('Querying users from database...');
  try {
    const result = await executeQuery('SELECT id, username, email, ad FROM istifadeciler ORDER BY id DESC LIMIT 10');
    console.log('Registered Users (Latest 10):');
    result.rows.forEach(row => {
      console.log(`- Username: ${row.USERNAME}, Email: ${row.EMAIL}, Name: ${row.AD}`);
    });
  } catch (error) {
    console.error('Failed to query database:', error);
  }
}

main();
