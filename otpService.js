const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { executeQuery } = require('./db');
require('dotenv').config();

// SHA-256 hashing for secure short-term storage of verification codes
function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Mail transporter initialization
let transporter = null;
const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

if (host && user && pass) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
  console.log('OtpService: SMTP Mailer Transporter initialized.');
} else {
  console.log('OtpService: SMTP credentials not set in .env. OTP will be printed to console.');
}

async function sendOtpEmail(email, code, purposeText) {
  const subject = `Subscription Portal - ${purposeText} Verification Code`;
  const text = `Your verification code is: ${code}. It is valid for 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4f46e5; margin-top: 0;">Verification Code (OTP)</h2>
      <p>You requested a verification code to complete your <strong>${purposeText}</strong> process.</p>
      <div style="font-size: 28px; font-weight: bold; background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; border: 1px dashed #cbd5e1; letter-spacing: 6px; margin: 20px 0; color: #1f2937;">
        ${code}
      </div>
      <p style="font-size: 14px; color: #4b5563;">This code is valid for 10 minutes. If you did not initiate this action, you can safely ignore this email.</p>
    </div>
  `;

  // Standard development logging to catch the OTP codes in testing
  console.log(`\n==================================================`);
  console.log(`[EMAIL OUTBOX] To: ${email}`);
  console.log(`Subject: ${subject}`);
  console.log(`OTP Code: ${code}`);
  console.log(`==================================================\n`);

  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@example.com',
        to: email,
        subject,
        text,
        html
      });
      return true;
    } catch (error) {
      console.error('OtpService: Mail sending failed:', error);
      return false;
    }
  }
  return true;
}

async function generateOtp(email, purpose, payloadObj) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = hashOtp(code);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

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
