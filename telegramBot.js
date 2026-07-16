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
    sendTelegramMessage(chatId, 'Salam! <b>Abunəm</b> OTP botuna xoş gəlmisiniz.\n\nQeydiyyat kodunu almaq üçün saytda daxil etdiyiniz <b>email ünvanınızı</b> yazın:');
    return;
  }

  // Check if it's a valid email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(text)) {
    const email = text.toLowerCase().trim();

    try {
      // Look up pending registration data stored by /register/initiate
      const pendingResult = await executeQuery(
        `SELECT payload, expires_at FROM otp_verifications WHERE email = $1 AND purpose = 'REGISTER_PENDING' ORDER BY created_at DESC LIMIT 1`,
        [email]
      );

      if (pendingResult.rows.length === 0) {
        sendTelegramMessage(chatId, '❌ Bu email ilə aktiv qeydiyyat tapılmadı.\n\nZəhmət olmasa əvvəlcə saytda qeydiyyat formasını doldurun, sonra bura gəlin.');
        return;
      }

      const pendingRow = pendingResult.rows[0];

      // Check if pending record is expired
      if (new Date() > new Date(pendingRow.EXPIRES_AT)) {
        sendTelegramMessage(chatId, '⏰ Qeydiyyat sessiyasının vaxtı bitib. Zəhmət olmasa saytda yenidən qeydiyyat formasını doldurun.');
        return;
      }

      const payload = pendingRow.PAYLOAD;

      // Generate 6-digit OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = hashOtp(code);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      // Delete old REGISTER OTPs for this email
      await executeQuery(
        `DELETE FROM otp_verifications WHERE email = $1 AND purpose = 'REGISTER' AND verified = FALSE`,
        [email],
        { autoCommit: true }
      );

      // Insert new OTP with the registration payload
      await executeQuery(
        `INSERT INTO otp_verifications (email, code_hash, purpose, payload, expires_at) VALUES ($1, $2, 'REGISTER', $3, $4)`,
        [email, codeHash, payload, expiresAt],
        { autoCommit: true }
      );

      // Send the code to the user
      sendTelegramMessage(chatId, `✅ Sizin <b>Abunəm</b> qeydiyyat kodunuz:\n\n<code>${code}</code>\n\nBu kodu saytdakı OTP xanasına daxil edin.\n⏱ Kod <b>10 dəqiqə</b> ərzində etibarlıdır.`);

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
