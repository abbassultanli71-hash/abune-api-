const crypto = require('crypto');
const https = require('https');
const { executeQuery } = require('./db');
require('dotenv').config();

// SHA-256 hashing for secure short-term storage of verification codes
function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Brevo Web API configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SMTP_FROM || 'abbassultanli71@gmail.com';

async function sendOtpEmail(email, code, purposeText) {
  if (!BREVO_API_KEY) {
    console.error('OtpService: BREVO_API_KEY environment variable is not defined!');
    return false;
  }

  const subject = `Subscription Portal - ${purposeText} Verification Code`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5; margin-top: 0;">Verification Code (OTP)</h2>
      <p>You requested a verification code to complete your <strong>${purposeText}</strong> process.</p>
      <div style="font-size: 28px; font-weight: bold; background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; border: 1px dashed #cbd5e1; letter-spacing: 6px; margin: 20px 0; color: #1f2937;">
        ${code}
      </div>
      <p style="font-size: 14px; color: #4b5563;">This code is valid for 3 minutes. If you did not initiate this action, you can safely ignore this email.</p>
    </div>
  `;

  // Standard development logging to catch the OTP codes in testing
  console.log(`\n==================================================`);
  console.log(`[EMAIL OUTBOX] To: ${email}`);
  console.log(`Subject: ${subject}`);
  console.log(`OTP Code: ${code}`);
  console.log(`==================================================\n`);

  const postData = JSON.stringify({
    sender: {
      name: 'Abunəm',
      email: SENDER_EMAIL
    },
    to: [
      {
        email: email
      }
    ],
    subject: subject,
    htmlContent: htmlContent
  });

  const options = {
    hostname: 'api.brevo.com',
    port: 443,
    path: '/v3/smtp/email',
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('OtpService: Email sent successfully via Brevo API.');
          resolve(true);
        } else {
          console.error(`OtpService: Brevo API failed with status ${res.statusCode}:`, data);
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.error('OtpService: Brevo HTTP Request error:', error);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

async function generateOtp(email, purpose, payloadObj) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = hashOtp(code);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 3); // 3 minutes expiration

  const normalizedEmail = email.toLowerCase().trim();
  const payloadStr = JSON.stringify(payloadObj);

  // 1. Delete previous active OTPs for the same email and purpose to prevent database bloat
  await executeQuery(`
    DELETE FROM otp_verifications 
    WHERE email = :email AND purpose = :purpose AND verified = FALSE
  `, { email: normalizedEmail, purpose }, { autoCommit: true });

  // 2. Insert new OTP verification record
  await executeQuery(`
    INSERT INTO otp_verifications (email, code_hash, purpose, payload, expires_at)
    VALUES (:email, :codeHash, :purpose, :payload, :expiresAt)
  `, {
    email: normalizedEmail,
    codeHash,
    purpose,
    payload: payloadStr,
    expiresAt
  }, { autoCommit: true });

  // 3. Send email asynchronously
  const purposeText = purpose === 'REGISTER' ? 'Registration' : 'Password Reset';
  module.exports.sendOtpEmail(normalizedEmail, code, purposeText).catch(err => {
    console.error('OtpService: Async sendOtpEmail error:', err);
  });

  return true;
}

async function verifyOtp(email, purpose, code) {
  const normalizedEmail = email.toLowerCase().trim();
  const codeHash = hashOtp(code.trim());

  // Retrieve latest unverified OTP code session
  const result = await executeQuery(`
    SELECT id, email, code_hash, purpose, payload, expires_at, verified 
    FROM otp_verifications 
    WHERE email = :email AND purpose = :purpose AND verified = FALSE
    ORDER BY created_at DESC
  `, { email: normalizedEmail, purpose });

  if (result.rows.length === 0) {
    return { isValid: false, message: 'Aktiv təsdiq kodu tapılmadı və ya artıq istifadə olunub.' };
  }

  // Accessing keys in uppercase matching db.js result transformation
  const row = result.rows[0];

  const expiresAt = new Date(row.EXPIRES_AT);
  if (new Date() > expiresAt) {
    return { isValid: false, message: 'Təsdiq kodunun vaxtı bitib.' };
  }

  if (row.CODE_HASH !== codeHash) {
    return { isValid: false, message: 'Təsdiq kodu yanlışdır.' };
  }

  // Mark verification record as verified
  await executeQuery(`
    UPDATE otp_verifications 
    SET verified = TRUE 
    WHERE id = :id
  `, { id: row.ID }, { autoCommit: true });

  let payload = {};
  try {
    payload = JSON.parse(row.PAYLOAD);
  } catch (err) {
    console.error('OtpService: Failed to parse verification payload JSON:', err);
  }

  return { isValid: true, payload };
}

async function deleteOtp(email, purpose) {
  const normalizedEmail = email.toLowerCase().trim();
  await executeQuery(`
    DELETE FROM otp_verifications 
    WHERE email = :email AND purpose = :purpose
  `, { email: normalizedEmail, purpose }, { autoCommit: true });
}

module.exports = {
  generateOtp,
  verifyOtp,
  deleteOtp,
  sendOtpEmail
};
