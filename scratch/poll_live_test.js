const https = require('https');

const url = 'https://abune-api.onrender.com/api/test-email-direct';
let attempts = 0;
const maxAttempts = 30; // 2.5 minutes total

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchTest() {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    }).on('error', (e) => {
      resolve({ status: 0, body: e.message });
    });
  });
}

async function main() {
  console.log(`Polling ${url}...`);
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`Attempt ${attempts}/${maxAttempts}...`);
    const result = await fetchTest();
    console.log(`Status: ${result.status}`);
    
    // If it is 404, it means the new code isn't deployed yet (or it's still running old code).
    // If it is 401, it means it's hitting the old code's auth middleware.
    // If it is 200 or 500, the new route is live!
    if (result.status === 200 || result.status === 500) {
      console.log('--- DEPLOYMENT IS LIVE! ---');
      console.log('Response Body:', result.body);
      break;
    } else {
      console.log('Response (waiting for deploy):', result.body.substring(0, 100));
    }
    
    await sleep(5000);
  }
}

main();
