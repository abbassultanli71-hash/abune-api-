const https = require('https');

const postData = JSON.stringify({
  username: 'new_qa_user_' + Math.floor(Math.random() * 1000),
  ad: 'QA Tester',
  email: 'abbas.sultanli@mail.ru', // testing if this email is already registered
  password: 'Password123!'
});

const credentials = Buffer.from('admin:admin123').toString('base64');

const options = {
  hostname: 'abune-api.onrender.com',
  port: 443,
  path: '/api/istifadeciler/register/initiate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + credentials,
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Sending registration request with abbas.sultanli@mail.ru...');
const req = https.request(options, (res) => {
  console.log(`Live Server Status Code: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Live Server Response:', data);
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e);
});

req.write(postData);
req.end();
