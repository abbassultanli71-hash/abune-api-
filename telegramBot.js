const https = require('https');
const crypto = require('crypto');
const { executeQuery } = require('./db');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8843118073:AAHseW3o55L7jzC1quhyDzhhTeJobp91QRc';

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function sendTelegramMessage(chatId, text) {
  const postData = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
  });
  req.on('error', (e) => {
    console.error('Telegram Bot: send error:', e);
  });
  req.write(postData);
  req.end();
}

function initTelegramWebhook() {
  const webhookUrl = `https://abune-api.onrender.com/telegram-webhook`;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Telegram Bot: Webhook registration response:', data);
    });
  }).on('error', (e) => {
    console.error('Telegram Bot: Webhook registration failed:', e);
  });
}

async function handleTelegramUpdate(req, res) {
  res.sendStatus(200);

  const update = req.body;
  if (!update || !update.message) return;

  const chatId = update.message.chat.id;
  const text = (update.message.text || '').trim();

  if (text.startsWith('/start')) {
    sendTelegramMessage(chatId, 'Salam! <b>Abunəm</b> OTP botuna xoş gəlmisiniz.\n\nTəsdiq kodunu almaq üçün zəhmət olmasa saytda qeydiyyatdan keçdiyiniz <b>email ünvanınızı</b> yazın:');
    return;
  }

  // Check if it's a valid email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(text)) {
    const email = text.toLowerCase().trim();
    
    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = hashOtp(code);
    
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiration

    try {
      // 1. Delete previous active OTPs for the same email and purpose to prevent database bloat
      await executeQuery(`
        DELETE FROM otp_verifications 
        WHERE email = :email AND purpose = 'REGISTER' AND verified = FALSE
      `, { email }, { autoCommit: true });

      // 2. Insert new OTP verification record
      await executeQuery(`
        INSERT INTO otp_verifications (email, code_hash, purpose, payload, expires_at)
        VALUES (:email, :codeHash, 'REGISTER', :payload, :expiresAt)
      `, {
        email,
        codeHash,
        payload: JSON.stringify({ chatId, source: 'telegram' }),
        expiresAt
      }, { autoCommit: true });

      // Send the code to the user in Telegram
      sendTelegramMessage(chatId, `Sizin Abunəm qeydiyyat təsdiq kodunuz:\n\n<code>${code}</code>\n\nBu kodu saytdakı qeydiyyat xanasına daxil edin. Kod 10 dəqiqə ərzində etibarlıdır.`);
    } catch (err) {
      console.error('Telegram Bot: DB error during OTP generation:', err);
      sendTelegramMessage(chatId, 'Sistemdə texniki xəta baş verdi. Zəhmət olmasa bir az sonra yenidən cəhd edin.');
    }
  } else {
    sendTelegramMessage(chatId, 'Zəhmət olmasa düzgün bir email ünvanı daxil edin (məsələn: <code>abbas@mail.ru</code>).');
  }
}

module.exports = {
  initTelegramWebhook,
  handleTelegramUpdate
};
