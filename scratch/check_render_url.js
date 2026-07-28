const https = require('https');

const urls = [
  'https://abunelik-api.onrender.com/api-docs',
  'https://abune-api.onrender.com/api-docs'
];

function checkUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      console.log(`URL: ${url} -> Status Code: ${res.statusCode}`);
      resolve(res.statusCode === 200 || res.statusCode === 401);
    }).on('error', (e) => {
      console.log(`URL: ${url} -> Error: ${e.message}`);
      resolve(false);
    });
  });
}

async function main() {
  for (const url of urls) {
    await checkUrl(url);
  }
}

main();
