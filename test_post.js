const http = require('http');

const data = JSON.stringify({
  ad: 'Namiq Hesanov',
  email: 'namiq@example.com'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/istifadeciler',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Basic ' + Buffer.from('admin:admin123').toString('base64')
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', body);
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write(data);
req.end();
