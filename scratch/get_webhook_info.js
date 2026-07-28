const https = require('https');

const token = '8843118073:AAHseW3o55L7jzC1quhyDzhhTeJobp91QRc';

https.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, (res) => {
  console.log(`Telegram API Status Code: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Webhook Info:', data);
  });
}).on('error', (e) => {
  console.error('Request failed:', e);
});
