// server.js
// Modified to implement:
// 1) Subscription account credential validation (mock).
// 2) Prevent deleting payment method if used by active subscriptions.
// 3 & 7) Automatic card brand detection from PAN; removed manual cardType.
// 4) Added endpoint to check whether user has payment methods.
// 5) Removed DELETE notification endpoint and added PATCH /.../read to mark read (is_read column).
// 6) Swagger docs updated for modified endpoints and new error responses.
// Only changed this file as requested.

const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { executeQuery } = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { startDueSubscriptionNotifierJob } = require('./jobs/dueSubscriptionNotifier');
const { generateDueMessage } = require('./services/notificationService');

const app = express();
app.use(cors());
app.use(express.json());

function lowercaseKeys(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.keys(obj).reduce((acc, key) => {
      acc[key.toLowerCase()] = lowercaseKeys(obj[key]);
      return acc;
    }, {});
  } else if (Array.isArray(obj)) {
    return obj.map(lowercaseKeys);
  }
  return obj;
}

app.use((req, res, next) => {
  if (req.body) { req.body = lowercaseKeys(req.body); }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure API"');
    return res.status(401).send('Giriş qadağandır: İstifadəçi adı və şifrə tələb olunur.');
  }
  try {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];
    const API_USER = process.env.API_USER || 'admin';
    const API_PASSWORD = process.env.API_PASSWORD || 'admin123';
    if (user === API_USER && pass === API_PASSWORD) {
      next();
    } else {
      res.setHeader('WWW-Authenticate', 'Basic realm="Secure API"');
      return res.status(401).send('Giriş qadağandır: İstifadəçi adı və ya şifrə yanlışdır.');
    }
  } catch (err) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure API"');
    return res.status(401).send('Giriş qadağandır: Giriş formatı yanlışdır.');
  }
};

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Abunəlik İdarəetmə Platforması API',
      version: '1.1.0',
      description: 'PostgreSQL verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı. Bütün istifadəçi-aid endpointlər "username" üzərindən işləyir[...]'
    },
    servers: [
      { url: '/', description: 'Cari Server (Lokal və ya Tunel)' },
      { url: `http://localhost:${PORT}`, description: 'Yerli API Serveri' },
    ],
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic', description: 'API-ya giriş üçün istifadəçi adı və şifrə daxil edin.' }
      }
    },
    security: [{ basicAuth: [] }]
  },
  apis: ['./server.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
// Public routes - no auth needed
app.get('/', (req, res) => { res.redirect('/app'); });
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app.html')); });
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Protected routes
app.use('/api-docs', authMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use('/api', authMiddleware);

// ── Helpers ────────────────────────────────────────────────────────────
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// Luhn alqoritmi ilə kart nömrəsinin (PAN) düzgünlüyünü yoxlayır.
function isValidPanLuhn(pan) {
  if (typeof pan !== 'string') return false;
  const cleaned = pan.replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(cleaned)) return false; // əsas format yoxlanışı

  let sum = 0;
  let shouldDouble = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned[i], 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

// Kartın istifadə tarixini (MM/YY) yoxlayır.
function isValidKartTarixi(tarixi) {
  if (!tarixi) return { valid: true };

  const formatRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
  if (!formatRegex.test(tarixi)) {
    return { valid: false, reason: 'FORMAT' };
  }

  const [mm, yy] = tarixi.split('/').map(Number);
  const now = new Date();
  const bugunAy = now.getMonth() + 1;
  const bugunIl = now.getFullYear() % 100;

  if (yy < bugunIl || (yy === bugunIl && mm < bugunAy)) {
    return { valid: false, reason: 'EXPIRED' };
  }

  return { valid: true };
}

function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  const trimmed = username.trim();
  return /^[a-zA-Z0-9_.]{3,50}$/.test(trimmed);
}

// PAN-i cavablarda gostermek ucun maskalayir - yalniz son 4 reqem qalir.
function maskPan(pan) {
  if (!pan || String(pan).length < 4) return null;
  const last4 = String(pan).slice(-4);
  return `**** **** **** ${last4}`;
}

const ICAZE_VERILEN_VALYUTALAR = ['AZN', 'USD', 'EUR'];
const ICAZE_VERILEN_ODENIS_TEZLIKLERI = ['monthly', 'yearly', 'quarterly', 'weekly'];
const ICAZE_VERILEN_KATEQORIYALAR = ['Entertainment', 'Music', 'Education', 'Health & Fitness', 'Productivity', 'Gaming', 'Cloud Storage', 'News', 'Food & Delivery', 'Shopping', 'Finance', 'Other'];
const ICAZE_VERILEN_STATUSLAR = ['active', 'deactive'];

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
}

function isValidCurrency(valyuta) {
  return ICAZE_VERILEN_VALYUTALAR.includes(getValidCurrency(valyuta));
}

async function getUserIdByUsername(username) {
  if (!username) return null;
  const result = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });
  if (result.rows.length === 0) return null;
  return result.rows[0].ID;
}

function hesablaNovbetiOdenisTarixi(baslamaTarixiStr, odenisTezliyi) {
  const [y, m, d] = baslamaTarixiStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  switch (odenisTezliyi) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case 'monthly':
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Standard response helpers
function successResponse(res, statusCode, message, data) {
  return res.status(statusCode).json({ code: statusCode, message, data });
}

function errorResponse(res, statusCode, message, errorCode, errorMessage) {
  return res.status(statusCode).json({
    code: statusCode,
    message,
    data: null,
    error: { code: errorCode, message: errorMessage }
  });
}

// Abunəlik yarananda avtomatik bildiriş əlavə edir
async function addAutoNotification(userId, abunelikId, appAd, novbetiOdenisTarixi) {
  try {
    const bugun = new Date();
    bugun.setUTCHours(0, 0, 0, 0);
    const [ny, nm, nd] = novbetiOdenisTarixi.split('-').map(Number);
    const novbetiDate = new Date(Date.UTC(ny, nm - 1, nd));
    const qalanGun = Math.ceil((novbetiDate - bugun) / (1000 * 60 * 60 * 24));

    const { basliq, mesaj } = generateDueMessage(appAd, novbetiOdenisTarixi, qalanGun);

    await executeQuery(
      `INSERT INTO bildirisler (istifadeci_id, abunelik_id, basliq, mesaj) VALUES (:istifadeci_id, :abunelik_id, :basliq, :mesaj)`,
      { istifadeci_id: userId, abunelik_id: abunelikId, basliq, mesaj },
      { autoCommit: true }
    );
  } catch (err) {
    console.error('Auto notification error:', err.message);
  }
}
// Abunəlik yarananda avtomatik ödəniş tarixçəsi əlavə edir
async function addAutoPaymentHistory(userId, abunelikId, qiymet, baslamaTarixi) {
  try {
    await executeQuery(
      `INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
       VALUES (:abunelik_id, :istifadeci_id, :odenis_tarixi, :mebleq, 'success')`,
      {
        abunelik_id: abunelikId,
        istifadeci_id: userId,
        odenis_tarixi: baslamaTarixi,
        mebleq: qiymet
      },
      { autoCommit: true }
    );
  } catch (err) {
    console.error('Auto payment history error:', err.message);
  }
}

async function syncBudgetSpent(userId) {
  try {
    const activeSubs = await executeQuery(
      `SELECT qiymet FROM abunelikler WHERE istifadeci_id = :userId AND status = 'active'`,
      { userId }
    );
    let total = 0;
    for (const row of activeSubs.rows) { total += Number(row.QIYMET); }
    await executeQuery(
      `UPDATE budceler SET hesab_mebleqi = :total WHERE istifadeci_id = :userId`,
      { total, userId },
      { autoCommit: true }
    );
  } catch (err) {
    console.error('syncBudgetSpent xetasi:', err.message);
  }
}

// --- New helper: mock account validation for external apps (Netflix example) ---
function mockValidateServiceAccount(appName, email, password) {
  // Example mock: Netflix requires netflix@test.com / 123456
  if (!appName) return false;
  const name = String(appName).trim().toLowerCase();
  if (name === 'netflix') {
    return email === 'netflix@test.com' && password === '123456';
  }
  // For other apps we emulate "success" in the mock (since real validation is out of scope).
  // If you want to be stricter, add more known mocks here.
  return true;
}

// New helper: detect card brand from PAN prefix
function detectCardBrand(pan) {
  if (!pan || typeof pan !== 'string') return null;
  const cleaned = pan.replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(cleaned)) return null;

  // Visa: starts with 4
  if (cleaned.startsWith('4')) return 'Visa';

  // Mastercard: 51-55
  const firstTwo = Number(cleaned.slice(0, 2));
  if (firstTwo >= 51 && firstTwo <= 55) return 'Mastercard';

  // Mastercard (new range): 2221-2720 (first 4 digits compared)
  // Check first 4 digits (or more) for range
  const firstFour = Number(cleaned.slice(0, 4));
  if (firstFour >= 2221 && firstFour <= 2720) return 'Mastercard';

  return null;
}

// =============================================
// --- ISTIFADECILER (Users) ROUTES ---
// =============================================
/**
 * @swagger
 * /api/istifadeciler/{username}:
 *   get:
 *     summary: Username-ə görə istifadəçini gətirir
 *     tags: [İstifadəçilər]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const sql = `SELECT id, username, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE username = :username`;
    const result = await executeQuery(sql, { username });
    if (result.rows.length === 0) {
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    }
    return successResponse(res, 200, 'Success', { user: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler:
 *   post:
 *     summary: Yeni istifadəçi əlavə edir (ID avtomatik sıra ilə yaranır)
 *     tags: [İstifadəçilər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - ad
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               ad:
 *                 type: string
 *                 example: Abbas Abbasov
 *               email:
 *                 type: string
 *                 example: abbas@example.com
 *               password:
 *                 type: string
 *                 example: SifremGizli123
 *     responses:
 *       201:
 *         description: İstifadəçi yaradıldı
 */
app.post('/api/istifadeciler', async (req, res) => {
  const { username, ad, email, password } = req.body;

  if (!username || !ad || !email || !password) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad, email və password sahələri məcburidir.');

  const trimmedUsername = String(username).trim();
  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();
  const trimmedPassword = String(password);

  if (trimmedUsername.length === 0 || trimmedAd.length === 0 || trimmedEmail.length === 0 || trimmedPassword.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'username,[...]');
  if (!isValidUsername(trimmedUsername)) return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığında o[...]');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (trimmedPassword.length < 6 || trimmedPassword.length > 72) return errorResponse(res, 400, 'Bad Request', 'INVALID_PASSWORD_LENGTH', 'Şifrə ən azı 6 və ən çoxu 72 simvoldan ibarət ol[...]');

  try {
    const usernameCheck = await executeQuery(`SELECT username FROM istifadeciler WHERE username = :username`, { username: trimmedUsername });
    if (usernameCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_USERNAME', 'Bu username ilə artıq istifadəçi mövcuddur.');

    const emailCheck = await executeQuery(`SELECT email FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    if (emailCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    const passwordHash = await bcrypt.hash(trimmedPassword, 10);

    await executeQuery(
      `INSERT INTO istifadeciler (username, ad, email, password) VALUES (:username, :ad, :email, :password)`,
      { username: trimmedUsername, ad: trimmedAd, email: trimmedEmail, password: passwordHash },
      { autoCommit: true }
    );

    const userResult = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username: trimmedUsername });
    const userId = userResult.rows[0].ID;
    await executeQuery(
      `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema, tema_rengi) VALUES (:userId, 'AZN', 'email', 'az', 'dark', 'gold')`,
      { userId }, { autoCommit: true }
    );
    await executeQuery(
      `INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, hesab_mebleqi) VALUES (:userId, 300.00, 'AZN', 0.00)`,
      { userId }, { autoCommit: true }
    );
    return successResponse(res, 201, 'Created', { message: 'İstifadəçi və onun ilkin ayarları uğurla yaradıldı.' });
  } catch (err) {
    if (err.code === '23505') return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Məlumatların unikallığı pozuldu (eyni username və ya email artıq mövcuddur).');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/login:
 *   post:
 *     summary: Username və şifrə ilə giriş edir
 *     tags: [İstifadəçilər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               password:
 *                 type: string
 *                 example: SifremGizli123
 *     responses:
 *       200:
 *         description: Giriş uğurludur
 *       404:
 *         description: İstifadəçi tapılmadı
 *       401:
 *         description: Şifrə səhvdir
 */
app.post('/api/istifadeciler/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username və password sahələri məcburidir.');

  const trimmedUsername = String(username).trim();
  const trimmedPassword = String(password);

  try {
    const sql = `SELECT id, username, ad, email, password, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE username = :username`;
    const result = await executeQuery(sql, { username: trimmedUsername });

    if (result.rows.length === 0) {
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    }

    const userRow = result.rows[0];
    const storedHash = userRow.PASSWORD;

    if (!storedHash) {
      return errorResponse(res, 401, 'Unauthorized', 'WRONG_PASSWORD', 'Şifrə səhvdir.');
    }

    const isMatch = await bcrypt.compare(trimmedPassword, storedHash);
    if (!isMatch) {
      return errorResponse(res, 401, 'Unauthorized', 'WRONG_PASSWORD', 'Şifrə səhvdir.');
    }

    const { PASSWORD, ...userWithoutPassword } = userRow;
    return successResponse(res, 200, 'Success', { user: userWithoutPassword });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{username}:
 *   put:
 *     summary: İstifadəçi məlumatlarını yeniləyir (istəyə görə username də dəyişdirilə bilər)
 *     tags: [İstifadəçilər]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ad, email]
 *             properties:
 *               ad:
 *                 type: string
 *               email:
 *                 type: string
 *                 example: abbas@example.com
 *               username:
 *                 type: string
 *                 description: Yalnız username-i dəyişmək istəyəndə göndərin.
 *                 example: abbas.new
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       404:
 *         description: Tapılmadı
 */
app.put('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  const { ad, email, username: yeniUsername } = req.body;

  if (!ad || !email) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Ad və email sahələri məcburidir.');
  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();
  if (trimmedAd.length === 0 || trimmedEmail.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'Ad və email sahələri boş qoyula bilməz.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır.');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');

  let trimmedYeniUsername = null;
  if (yeniUsername !== undefined && yeniUsername !== null && String(yeniUsername).trim() !== '') {
    trimmedYeniUsername = String(yeniUsername).trim();
    if (!isValidUsername(trimmedYeniUsername)) return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığ�[...]');
  }

  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });
    if (userCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    if (trimmedYeniUsername && trimmedYeniUsername !== username) {
      const dupCheck = await executeQuery(`SELECT username FROM istifadeciler WHERE username = :yeniUsername`, { yeniUsername: trimmedYeniUsername });
      if (dupCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_USERNAME', 'Bu username ilə artıq istifadəçi mövcuddur.');
    }

    const emailCheck = await executeQuery(`SELECT email FROM istifadeciler WHERE email = :email AND username != :username`, { email: trimmedEmail, username });
    if (emailCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    const finalUsername = trimmedYeniUsername || username;
    const sql = `UPDATE istifadeciler SET username = :finalUsername, ad = :ad, email = :email WHERE username = :username`;
    const result = await executeQuery(sql, { finalUsername, ad: trimmedAd, email: trimmedEmail, username }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const updated = await executeQuery(
      `SELECT id, username, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE username = :finalUsername`, { finalUsername }
    );
    return successResponse(res, 200, 'Updated', { user: updated.rows[0] });
  } catch (err) {
    if (err.code === '23505') return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Bu email və ya username artıq mövcuddur.');
    if (err.code === '23503') return errorResponse(res, 400, 'Bad Request', 'FK_CONSTRAINT', 'İstifadəçinin abunəliyi və ya bildirişi olduğu üçün bu əməliyyat mümkün deyil.');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{username}:
 *   delete:
 *     summary: İstifadəçini silir
 *     tags: [İstifadəçilər]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Silindi
 *       404:
 *         description: Tapılmadı
 */
app.delete('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await executeQuery(`DELETE FROM istifadeciler WHERE username = :username`, { username }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'İstifadəçi uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- ABUNELIKLER (Subscriptions) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/abunelikler:
 *   get:
 *     summary: İstifadəçinin abunəliklərini siyahılayır (username ilə)
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       400:
 *         description: username göndərilmədi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/abunelikler', async (req, res) => {
  const { username } = req.query;
  if (!username) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `
      SELECT a.id AS abunelik_id, u.username, a.ad, a.qiymet, a.valyuta, a.odenis_tezliyi,
             TO_CHAR(a.baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
             TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi,
             a.kateqoriya, a.status, a.odenis_metodu_id,
             TO_CHAR(a.yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
      FROM abunelikler a JOIN istifadeciler u ON a.istifadeci_id = u.id
      WHERE a.istifadeci_id = :istifadeci_id ORDER BY a.id
    `;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No subscriptions found', { subscriptions: [] });
    return successResponse(res, 200, 'Success', { subscriptions: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler:
 *   post:
 *     summary: Yeni abunəlik əlavə edir (novbeti_odenis_tarixi avtomatik hesablanır)
 *     tags: [Abunəliklər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - ad
 *               - qiymet
 *               - baslama_tarixi
 *               - accountEmail
 *               - accountPassword
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               ad:
 *                 type: string
 *                 example: Netflix
 *               qiymet:
 *                 type: number
 *                 example: 12.99
 *                 description: 0-dan böyük olmalıdır
 *               valyuta:
 *                 type: string
 *                 enum: [AZN, USD, EUR]
 *                 example: AZN
 *               odenis_tezliyi:
 *                 type: string
 *                 enum: [monthly, yearly, quarterly, weekly]
 *                 example: monthly
 *               baslama_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-24"
 *               kateqoriya:
 *                 type: string
 *                 enum: [Entertainment, Music, Education, "Health & Fitness", Productivity, Gaming, "Cloud Storage", News, "Food & Delivery", Shopping, Finance, Other]
 *                 example: Entertainment
 *               accountEmail:
 *                 type: string
 *                 description: Application account email (used for validation only)
 *               accountPassword:
 *                 type: string
 *                 description: Application account password (used for validation only)
 *     responses:
 *       201:
 *         description: Abunəlik əlavə edildi
 *       404:
 *         description: ACCOUNT_NOT_FOUND - Application account not found or credentials incorrect
 */
app.post('/api/abunelikler', async (req, res) => {
  const { username, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya, odenis_metodu_id, accountemail, accountpassword } = req.body;

  if (!username || !ad || qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (username, ad, qiymet, baslama_tarixi) doldurun.');

  if (!accountemail || !accountpassword) {
    return errorResponse(res, 400, 'Bad Request', 'MISSING_ACCOUNT_CREDENTIALS', 'accountEmail və accountPassword sahələri məcburidir.');
  }

  const parsedQiymet = Number(qiymet);
  if (isNaN(parsedQiymet) || parsedQiymet <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_PRICE', 'Qiymət 0-dan böyük olmalıdır.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);

  const odenisTezliyi = odenis_tezliyi || 'monthly';
  if (!ICAZE_VERILEN_ODENIS_TEZLIKLERI.includes(odenisTezliyi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_FREQUENCY', `Yanlış ödəniş tezliyi: "${odenis_tezliyi}". Yalnız ${ICAZE_VERILEN_ODENIS_TEZLIKLERI.join(', ')} daxil edilə bilər.`);

  if (!isValidDate(baslama_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Başlama tarixi düzgün deyil: "${baslama_tarixi}" (Format: YYYY-MM-DD).`);

  if (kateqoriya && !ICAZE_VERILEN_KATEQORIYALAR.includes(kateqoriya))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CATEGORY', `Yanlış kateqoriya: "${kateqoriya}". Yalnız ${ICAZE_VERILEN_KATEQORIYALAR.join(', ')} daxil edilə bilər.`);

  const novbetiOdenisTarixi = hesablaNovbetiOdenisTarixi(baslama_tarixi, odenisTezliyi);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'Qeyd olunan istifadəçi (username) mövcud deyil.');

    // Account credentials validation (mock)
    const okAccount = mockValidateServiceAccount(ad, accountemail, accountpassword);
    if (!okAccount) {
      // Per requirement return specific 404 JSON
      return res.status(404).json({
        error: 'Not Found',
        code: 'ACCOUNT_NOT_FOUND',
        message: 'Application account not found or credentials are incorrect.'
      });
    }

    // Payment method required
    if (odenis_metodu_id === undefined || odenis_metodu_id === null || odenis_metodu_id === '') {
      return errorResponse(res, 400, 'Bad Request', 'PAYMENT_METHOD_REQUIRED', 'Ödəniş metodu (kart) seçilməlidir.');
    }
    const finalOdenisMetoduId = Number(odenis_metodu_id);
    if (isNaN(finalOdenisMetoduId)) {
      return errorResponse(res, 400, 'Bad Request', 'INVALID_PAYMENT_METHOD', 'Ödəniş metodu ID-si rəqəm olmalıdır.');
    }
    const cardCheck = await executeQuery(
      `SELECT id FROM odenis_metodlari WHERE id = :id AND istifadeci_id = :userId`,
      { id: finalOdenisMetoduId, userId }
    );
    if (cardCheck.rows.length === 0) {
      return errorResponse(res, 400, 'Bad Request', 'PAYMENT_METHOD_NOT_FOUND', 'Ödəniş metodu tapılmadı və ya istifadəçiyə məxsus deyil.');
    }

    // Budget checks (same as before)
    const budgetRow = await executeQuery(
      `SELECT b.limit_mebleq, b.valyuta FROM budceler b WHERE b.istifadeci_id = :userId`,
      { userId }
    );

    {
      const budgetLimit   = budgetRow.rows.length > 0 ? Number(budgetRow.rows[0].LIMIT_MEBLEQ) : 300;
      const budgetValyuta = budgetRow.rows.length > 0 ? (budgetRow.rows[0].VALYUTA || 'AZN') : 'AZN';

      const activeSubs = await executeQuery(
        `SELECT qiymet FROM abunelikler
          WHERE istifadeci_id = :userId AND status = 'active'`,
        { userId }
      );

      let currentTotal = 0;
      for (const row of activeSubs.rows) {
        currentTotal += Number(row.QIYMET);
      }

      const projectedTotal = currentTotal + parsedQiymet;

      if (projectedTotal > budgetLimit) {
        const remaining = Math.max(0, budgetLimit - currentTotal);
        return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED',
          `Büdcə limiti keçilir! ` +
          `Mövcud xərc: ${currentTotal.toFixed(2)} ${budgetValyuta}, ` +
          `yeni abunəlik: +${parsedQiymet.toFixed(2)} ${budgetValyuta}, ` +
          `cəmi: ${projectedTotal.toFixed(2)} ${budgetValyuta} — limit: ${budgetLimit.toFixed(2)} ${budgetValyuta}. ` +
          `(Qalan boş büdcə: ${remaining.toFixed(2)} ${budgetValyuta})`
        );
      }
    }

    const sql = `INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, odenis_metodu_id, status)
                 VALUES (:istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, :baslama_tarixi::DATE, :novbeti_odenis_tarixi::DATE, :kateqoriya, :odenis_metodu_id, 'active')
                 RETURNING id`;
    const binds = {
      istifadeci_id: userId, ad, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta),
      odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi: novbetiOdenisTarixi,
      kateqoriya: kateqoriya || null, odenis_metodu_id: finalOdenisMetoduId
    };

    const insertResult = await executeQuery(sql, binds, { autoCommit: true });
    const newSubId = insertResult.rows.length > 0 ? Number(insertResult.rows[0].ID) : null;

    // Avtomatik bildiriş əlavə et (bildiriş həmişə yaradılır — newSubId null olsa belə)
    await addAutoNotification(userId, newSubId, ad, novbetiOdenisTarixi);

    // Avtomatik ödəniş tarixçəsi əlavə et
    if (newSubId) {
      await addAutoPaymentHistory(userId, newSubId, parsedQiymet, baslama_tarixi);
    }

    await syncBudgetSpent(userId);

    return successResponse(res, 201, 'Created', {
      message: 'Abunəlik uğurla əlavə edildi. Bildiriş və ödəniş tarixçəsi avtomatik yaradıldı.',
      novbeti_odenis_tarixi: novbetiOdenisTarixi
    });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler/{id}:
 *   delete:
 *     summary: Abunəliyi ID-yə görə silir
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Silindi
 *       404:
 *         description: Tapılmadı
 */
app.delete('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const subCheck = await executeQuery(`SELECT id FROM abunelikler WHERE id = :id`, { id });
    if (subCheck.rows.length === 0)
      return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');

    // Əvvəlcə həmin abunəliyə aid bildirişləri sil
    await executeQuery(`DELETE FROM bildirisler WHERE abunelik_id = :id`, { id });

    // Sonra abunəliyin özünü sil
    const result = await executeQuery(`DELETE FROM abunelikler WHERE id = :id`, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Abunəlik və əlaqəli bildirişlər uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- BILDIRISLER (Notifications) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/bildirisler:
 *   get:
 *     summary: İstifadəçinin bildirişlərini siyahılayır (username ilə)
 *     tags: [Bildirişlər]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: İstifadəçinin username-i
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       400:
 *         description: username göndərilmədi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/bildirisler', async (req, res) => {
  const { username } = req.query;
  if (!username) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    // abunelik_id, app_adi və odenis_tezliyi də qaytarılır (dinamik hesablama üçün)
    const sql = `
      SELECT b.id AS bildiris_id, u.username,
             b.basliq, b.mesaj,
             b.abunelik_id, a.ad AS app_adi, a.odenis_tezliyi,
             TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') AS novbeti_odenis_tarixi,
             TO_CHAR(b.gonderilme_tarixi, 'YYYY-MM-DD') AS gonderilme_tarixi,
             COALESCE(b.is_read, false) AS is_read
      FROM bildirisler b
      JOIN istifadeciler u ON b.istifadeci_id = u.id
      LEFT JOIN abunelikler a ON b.abunelik_id = a.id
      WHERE b.istifadeci_id = :istifadeci_id
      ORDER BY b.id DESC
    `;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No notifications found', { notifications: [] });


    const XEBERDARLIQ_GUNLERI = { weekly: 2, monthly: 7, quarterly: 14, yearly: 30 };

    function xeberdarlıqTarixi(novbetiOdenisTarixiStr, odenisTezliyi) {
      const gunSayi = XEBERDARLIQ_GUNLERI[odenisTezliyi] ?? XEBERDARLIQ_GUNLERI.monthly;
      const [ny, nm, nd] = novbetiOdenisTarixiStr.split('-').map(Number);
      const d = new Date(Date.UTC(ny, nm - 1, nd));
      d.setUTCDate(d.getUTCDate() - gunSayi);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    const notifications = result.rows.map(row => {
      if (!row.NOVBETI_ODENIS_TARIXI) {
        return {
          bildiris_id: row.BILDIRIS_ID,
          username: row.USERNAME,
          basliq: row.BASLIQ,
          mesaj: row.MESAJ,
          gonderilme_tarixi: row.GONDERILME_TARIXI,
          is_read: !!row.IS_READ
        };
      }

      const [ny, nm, nd] = row.NOVBETI_ODENIS_TARIXI.split('-').map(Number);
      const novbetiDate = new Date(Date.UTC(ny, nm - 1, nd));

      const [gy, gm, gd] = row.GONDERILME_TARIXI.split('-').map(Number);
      const gonderilmeDate = new Date(Date.UTC(gy, gm - 1, gd));

      const dbQalanGun = Math.ceil(
        (novbetiDate - gonderilmeDate) / (1000 * 60 * 60 * 24)
      );

      let finalGonderilmeTarixi = row.GONDERILME_TARIXI;
      let finalQalanGun = dbQalanGun;

      const isReminder = dbQalanGun > 0 && (row.BASLIQ.includes('Xatırlatması') || row.BASLIQ.includes('Məlumatı') || row.BASLIQ.includes('Yaxınlaşan'));

      if (isReminder) {
        finalGonderilmeTarixi = xeberdarlıqTarixi(row.NOVBETI_ODENIS_TARIXI, row.ODENIS_TEZLIYI);
        const [hy, hm, hd] = finalGonderilmeTarixi.split('-').map(Number);
        const warningDate = new Date(Date.UTC(hy, hm - 1, hd));
        finalQalanGun = Math.ceil(
          (novbetiDate - warningDate) / (1000 * 60 * 60 * 24)
        );
      }

      const { basliq, mesaj } = generateDueMessage(row.APP_ADI, row.NOVBETI_ODENIS_TARIXI, finalQalanGun);

      return {
        bildiris_id: row.BILDIRIS_ID,
        username: row.USERNAME,
        basliq,
        mesaj,
        gonderilme_tarixi: finalGonderilmeTarixi,
        is_read: !!row.IS_READ
      };
    });

    return successResponse(res, 200, 'Success', { notifications });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * PATCH /api/bildirisler/{id}/read
 * Marks a notification as read (sets is_read = true).
 *
 * Responses:
 *   200 - Updated
 *   404 - NOTIFICATION_NOT_FOUND
 */
app.patch('/api/bildirisler/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return errorResponse(res, 400, 'Bad Request', 'INVALID_ID', 'id düzgün deyil.');
  try {
    const result = await executeQuery(
      `UPDATE bildirisler SET is_read = true WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    return successResponse(res, 200, 'Updated', { message: 'Bildiriş oxundu (is_read=true).' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// Also provide English-route alias per requirement /notifications/{id}/read
app.patch('/api/notifications/:id/read', async (req, res) => {
  // reuse the same implementation
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return errorResponse(res, 400, 'Bad Request', 'INVALID_ID', 'id düzgün deyil.');
  try {
    const result = await executeQuery(
      `UPDATE bildirisler SET is_read = true WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    return successResponse(res, 200, 'Updated', { message: 'Notification marked as read (is_read=true).' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- ODENIS TARIXCESI (Payment History) ROUTES ---
// =============================================
app.get('/api/odenis-tarixcesi', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `
      SELECT o.id AS odenis_tarixcesi_id,
             o.abunelik_id,
             a.ad AS app_adi,
             a.kateqoriya,
             a.valyuta,
             u.username,
             TO_CHAR(o.odenis_tarixi,          'YYYY-MM-DD') AS odenis_tarixi,

             o.mebleq,
             o.status
      FROM odenis_tarixcesi o
      JOIN istifadeciler  u ON o.istifadeci_id = u.id
      JOIN abunelikler    a ON o.abunelik_id   = a.id
      WHERE o.istifadeci_id = :istifadeci_id
      ORDER BY o.odenis_tarixi DESC
    `;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0)
      return successResponse(res, 200, 'No payment history found', { paymentHistory: [] });
    return successResponse(res, 200, 'Success', { paymentHistory: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// DELETE — ödəniş tarixçəsi üçün DELETE əməliyyatı mövcud deyil (biznes qaydası).
// /api/odenis-tarixcesi/:id DELETE → 405 Method Not Allowed
app.delete('/api/odenis-tarixcesi/:id', (req, res) => {
  return res.status(405).json({
    code: 405,
    message: 'Method Not Allowed',
    data: null,
    error: {
      code: 'DELETE_NOT_ALLOWED',
      message: 'Ödəniş tarixçəsi qeydləri silinə bilməz. Bu əməliyyat icazəsizdir (audit məqsədilə saxlanılır).'
    }
  });
});
// =============================================
// --- ODENIS METODLARI (Payment Methods) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/odenis-metodlari:
 *   get:
 *     summary: İstifadəçinin ödəniş metodlarını siyahılayır (username ilə)
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/odenis-metodlari', async (req, res) => {
  const { username } = req.query;
  if (!username) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

const sql = `SELECT c.id AS card_id,
                    u.username,
                    c.ad,
                    c.kart_tipi,
                    c.pan,
                    c.kart_istifade_tarixi,
                    c.status
             FROM odenis_metodlari c
             JOIN istifadeciler u ON c.istifadeci_id = u.id
             WHERE c.istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No payment methods found', { cards: [] });
    const maskedCards = result.rows.map(row => ({ ...row, PAN: maskPan(row.PAN) }));
    return successResponse(res, 200, 'Success', { cards: maskedCards });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * GET /api/odenis-metodlari/has-cards?username=...
 * Returns whether the user has any payment methods (cards).
 * Useful for frontend logic (show + button if none).
 */
app.get('/api/odenis-metodlari/has-cards', async (req, res) => {
  const { username } = req.query;
  if (!username) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    const result = await executeQuery(`SELECT id FROM odenis_metodlari WHERE istifadeci_id = :userId LIMIT 1`, { userId });
    const hasCards = result.rows.length > 0;
    return successResponse(res, 200, 'Success', { hasCards });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari:
 *   post:
 *     summary: Yeni ödəniş metodu (kart) əlavə edir (username ilə). Kart növü avtomatik aşkar edilir (card brand detection).
 *     tags: [Ödəniş Metodları]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - ad
 *               - pan
 *               - cvv
 *               - kart_istifade_tarixi
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               ad:
 *                 type: string
 *               pan:
 *                 type: string
 *                 example: "4111 1111 1111 1111"
 *               cvv:
 *                 type: string
 *                 example: "123"
 *               kart_istifade_tarixi:
 *                 type: string
 *                 example: "06/28"
 *     responses:
 *       201:
 *         description: Əlavə edildi
 *       400:
 *         description: INVALID_CARD_PREFIX - Unsupported or invalid card number.
 */
app.post('/api/odenis-metodlari', async (req, res) => {
  const { username, ad, pan, cvv, kart_istifade_tarixi } = req.body;
  if (!username || !ad || !pan) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad və pan sahələri məcburidir.');

  if (!pan) {
    return errorResponse(res, 400, 'Bad Request', 'PAN_REQUIRED', 'Kart nömrəsi (pan) məcburidir.');
  }
  if (!isValidPanLuhn(pan)) {
    return errorResponse(res, 400, 'Bad Request', 'INVALID_PAN',
      'Kart nömrəsi (pan) düzgün deyil (Luhn yoxlamasından keçmədi).');
  }

  if (cvv === undefined || cvv === null || cvv === '') {
    return errorResponse(res, 400, 'Bad Request', 'CVV_REQUIRED', 'cvv məcburidir.');
  }
  if (!/^\d{3}$/.test(String(cvv))) {
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CVV', 'cvv yalnız 3 rəqəmdən ibarət olmalıdır (məs: 123).');
  }

  if (!kart_istifade_tarixi) {
    return errorResponse(res, 400, 'Bad Request', 'EXPIRY_REQUIRED', 'Kartın istifadə tarixi (son tarix) məcburidir.');
  }
  {
    const tarixCheck = isValidKartTarixi(kart_istifade_tarixi);
    if (!tarixCheck.valid) {
      if (tarixCheck.reason === 'FORMAT') {
        return errorResponse(res, 400, 'Bad Request', 'INVALID_EXPIRY_FORMAT',
          'Kartın istifadə tarixinin formatı yanlışdır. Format: AA/İİ olmalıdır (Ay: 01-12, İl: 2 rəqəm, məs: 06/28, 12/30).');
      }
      if (tarixCheck.reason === 'EXPIRED') {
        return errorResponse(res, 400, 'Bad Request', 'EXPIRED_CARD',
          'Kartın istifadə müddəti bitib. Zəhmət olmasa etibarlı bir kart tarixi daxil edin.');
      }
    }
  }

  // Detect card brand automatically from PAN
  const detectedBrand = detectCardBrand(pan);
  if (!detectedBrand) {
    // Return required error shape for invalid prefix
    return res.status(400).json({
      error: 'Bad Request',
      code: 'INVALID_CARD_PREFIX',
      message: 'Unsupported or invalid card number.'
    });
  }

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
 await executeQuery(
  `INSERT INTO odenis_metodlari
   (istifadeci_id, ad, kart_tipi, pan, kart_istifade_tarixi)
   VALUES
   (:istifadeci_id, :ad, :kart_tipi, :pan, :kart_istifade_tarixi)`,
  {
    istifadeci_id: userId,
    ad,
    kart_tipi: detectedBrand,
    pan,
    kart_istifade_tarixi: kart_istifade_tarixi || null
  },
  { autoCommit: true }
);
    return successResponse(res, 201, 'Created', { message: 'Ödəniş metodu uğurla əlavə edildi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari/{id}:
 *   delete:
 *     summary: Ödəniş metodunu ID-yə görə silir
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Silindi
 *       404:
 *         description: Tapılmadı
 *       409:
 *         description: PAYMENT_METHOD_IN_USE - This payment method is linked to active subscriptions.
 */
app.delete('/api/odenis-metodlari/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return errorResponse(res, 400, 'Bad Request', 'INVALID_ID', 'id düzgün deyil.');
  try {
    // Check if this payment method is used by any active subscription
    const inUse = await executeQuery(`SELECT id FROM abunelikler WHERE odenis_metodu_id = :id AND status = 'active' LIMIT 1`, { id });
    if (inUse.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        code: 'PAYMENT_METHOD_IN_USE',
        message: 'This payment method is linked to active subscriptions.'
      });
    }

    const result = await executeQuery(
      `DELETE FROM odenis_metodlari WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Ödəniş metodu uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

app.delete('/api/odenis-metodlari', async (req, res) => {
  const { username, ad } = req.query;
  if (!username || !ad)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username və ad query parametrləri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    // Find cards matching this user and ad
    const cards = await executeQuery(`SELECT id FROM odenis_metodlari WHERE istifadeci_id = :userId AND ad = :ad`, { istifadeci_id: userId, ad });
    if (cards.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');

    const ids = cards.rows.map(r => r.ID);
    // Check if any of these ids are used by active subscriptions
    const placeholders = ids.map((_, idx) => `:id${idx}`).join(',');
    const binds = {};
    ids.forEach((v, i) => binds[`id${i}`] = v);
    const inUseQuery = `SELECT id FROM abunelikler WHERE odenis_metodu_id IN (${placeholders}) AND status = 'active' LIMIT 1`;
    const inUse = await executeQuery(inUseQuery, binds);
    if (inUse.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        code: 'PAYMENT_METHOD_IN_USE',
        message: 'This payment method is linked to active subscriptions.'
      });
    }

    const result = await executeQuery(
      `DELETE FROM odenis_metodlari WHERE istifadeci_id = :istifadeci_id AND ad = :ad`,
      { istifadeci_id: userId, ad },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Ödəniş metodu uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- BUDCELER (Budgets) ROUTES ---
// =============================================
app.get('/api/budceler', async (req, res) => {
  const { username } = req.query;
  if (!username) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `SELECT b.istifadeci_id, u.username, b.limit_mebleq, b.valyuta, b.hesab_mebleqi
                 FROM budceler b JOIN istifadeciler u ON b.istifadeci_id = u.id
                 WHERE b.istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No budget found', { budgets: [] });
    return successResponse(res, 200, 'Success', { budgets: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

app.post('/api/budceler', async (req, res) => {
  const { username, limit_mebleq, valyuta, hesab_mebleqi } = req.body;
  if (!username || limit_mebleq === undefined || limit_mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username və limit_mebleq sahələri məcburidir.');

  const parsedLimit = Number(limit_mebleq);
  if (isNaN(parsedLimit) || parsedLimit <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'limit_mebleq 0-dan böyük olmalıdır.');

  const parsedHesab = (hesab_mebleqi !== undefined && hesab_mebleqi !== null) ? Number(hesab_mebleqi) : 0;
  if (isNaN(parsedHesab) || parsedHesab < 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_AMOUNT', 'hesab_mebleqi mənfi ola bilməz.');

  if (parsedHesab > parsedLimit)
    return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED', 'Hesabdakı məbləğ limit məbləğdən çox ola bilməz.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const existingBudget = await executeQuery(
      `SELECT id FROM budceler WHERE istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );
    if (existingBudget.rows.length > 0)
      return errorResponse(res, 400, 'Bad Request', 'BUDGET_ALREADY_EXISTS',
        `"${username}" istifadəçisinin artıq büdcəsi mövcuddur (ID: ${existingBudget.rows[0].ID}). Mövcud büdcəni yeniləyin.`);

    await executeQuery(
      `INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, hesab_mebleqi) VALUES (:istifadeci_id, :limit_mebleq, :valyuta, :hesab_mebleqi)`,
      { istifadeci_id: userId, limit_mebleq: parsedLimit, valyuta: getValidCurrency(valyuta), hesab_mebleqi: parsedHesab },
      { autoCommit: true }
    );

    const newBudget = await executeQuery(
      `SELECT id FROM budceler WHERE istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );

    return successResponse(res, 201, 'Created', {
      message: 'Büdcə limiti uğurla quraşdırıldı.',
      id: newBudget.rows[0].ID
    });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

app.put('/api/budceler/:username', async (req, res) => {
  const { username } = req.params;
  const { limit_mebleq, valyuta, hesab_mebleqi } = req.body;

  if (limit_mebleq === undefined)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'limit_mebleq sahəsi məcburidir.');

  const parsedLimit = Number(limit_mebleq);
  if (isNaN(parsedLimit) || parsedLimit <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'limit_mebleq 0-dan böyük olmalıdır.');

  const parsedHesab = (hesab_mebleqi !== undefined && hesab_mebleqi !== null) ? Number(hesab_mebleqi) : 0;
  if (isNaN(parsedHesab) || parsedHesab < 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_AMOUNT', 'hesab_mebleqi mənfi ola bilməz.');

  if (parsedHesab > parsedLimit)
    return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED', 'Hesabdakı məbləğ limit məbləğdən çox ola bilməz.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `UPDATE budceler SET limit_mebleq=:limit_mebleq, valyuta=:valyuta, hesab_mebleqi=:hesab_mebleqi
       WHERE istifadeci_id=:istifadeci_id`,
      { limit_mebleq: parsedLimit, valyuta: getValidCurrency(valyuta), hesab_mebleqi: parsedHesab, istifadeci_id: userId },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'BUDGET_NOT_FOUND', 'Bu istifadəçi üçün büdcə tapılmadı.');

    return successResponse(res, 200, 'Updated', { message: 'Büdcə limiti uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});
app.delete('/api/budceler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `DELETE FROM budceler WHERE istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'BUDGET_NOT_FOUND', 'Bu istifadəçi üçün büdcə tapılmadı.');

    return successResponse(res, 200, 'Deleted', { message: 'Büdcə uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- AYARLAR (Settings) ROUTES ---
// =============================================
app.get('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `SELECT istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema, tema_rengi FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) {
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema, tema_rengi) VALUES (:istifadeci_id, 'AZN', 'email', 'az', 'dark', 'gold')`,
        { istifadeci_id: userId }, { autoCommit: true }
      );
      return successResponse(res, 200, 'Success', { settings: { istifadeci_id: userId, username, esas_valyuta: 'AZN', bildiris_metodu: 'email', dil: 'az', tema: 'dark', tema_rengi: 'gold' } });
    }
    return successResponse(res, 200, 'Success', { settings: { ...result.rows[0], USERNAME: username } });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

app.put('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  const { esas_valyuta, bildiris_metodu, dil, tema, tema_rengi } = req.body;
  const ICAZE_VERILEN_VALYUTALAR_L = ['AZN', 'USD', 'EUR'];
  const ICAZE_VERILEN_BILDIRISLER  = ['email', 'telegram'];
  const ICAZE_VERILEN_TEMALAR      = ['light', 'dark'];
  const ICAZE_VERILEN_TEMA_RENGLERI = ['gold', 'teal', 'coral', 'purple', 'blue'];
  const ICAZE_VERILEN_DILLER = ['az','en','ru','tr','de','fr','es','it','pt','ar','zh','ja','ko','hi','nl','pl','sv','no','da','fi','cs','sk','ro','hu','uk','ka','kk','uz','hy','fa','he','id','m[...]'];

  if (esas_valyuta && !ICAZE_VERILEN_VALYUTALAR_L.includes(esas_valyuta.toUpperCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${esas_valyuta}". Ya[...]`);
  if (bildiris_metodu && !ICAZE_VERILEN_BILDIRISLER.includes(bildiris_metodu.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_NOTIFICATION_METHOD', `Yanlış bildiriş meto[...]`);
  if (tema && !ICAZE_VERILEN_TEMALAR.includes(tema.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME', `Yanlış tema: "${tema}". Yalnız ${ICAZE_VERILEN_TEMALAR.join([...]`);
  if (tema_rengi && !ICAZE_VERILEN_TEMA_RENGLERI.includes(tema_rengi.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME_COLOR', `Yanlış tema rəngi: "${tema_rengi}". [...]`);
  if (dil && !ICAZE_VERILEN_DILLER.includes(dil.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_LANGUAGE', `Yanlış dil kodu: "${dil}". ISO 639-1 formatında olmalıdır.[...]`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const settingsCheck = await executeQuery(`SELECT istifadeci_id FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`, { istifadeci_id: userId });
    let sql;
    if (settingsCheck.rows.length > 0) {
      sql = `UPDATE istifadeci_ayarlari SET esas_valyuta=:esas_valyuta, bildiris_metodu=:bildiris_metodu, dil=:dil, tema=:tema, tema_rengi=:tema_rengi WHERE istifadeci_id=:istifadeci_id`;
    } else {
      sql = `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema, tema_rengi) VALUES (:istifadeci_id, :esas_valyuta, :bildiris_metodu, :dil, :tema, :tema_rengi)`;
    }
    await executeQuery(sql, {
      istifadeci_id: userId,
      esas_valyuta: esas_valyuta ? esas_valyuta.toUpperCase() : 'AZN',
      bildiris_metodu: bildiris_metodu ? bildiris_metodu.toLowerCase() : 'email',
      dil: dil ? dil.toLowerCase() : 'az',
      tema: tema ? tema.toLowerCase() : 'dark',
      tema_rengi: tema_rengi ? tema_rengi.toLowerCase() : 'gold'
    }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Ayarlar uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

async function initDatabase() {
  const migrations = [
    // istifadeci_ayarlari: tema_rengi sütunu
    `ALTER TABLE istifadeci_ayarlari ADD COLUMN IF NOT EXISTS tema_rengi VARCHAR(30) DEFAULT 'gold'`,
    // istifadeciler: username sütunu (əsas endpoint bu üzərindən işləyir)
    `ALTER TABLE istifadeciler ADD COLUMN IF NOT EXISTS username VARCHAR(50)`,
    // bildirisler: abunelik_id FK sütunu
    `ALTER TABLE bildirisler ADD COLUMN IF NOT EXISTS abunelik_id INTEGER REFERENCES abunelikler(id) ON DELETE SET NULL`,
    // odenis_metodlari: pan sütunu (tam kart nömrəsi)
    `ALTER TABLE odenis_metodlari ADD COLUMN IF NOT EXISTS pan VARCHAR(19)`,
    // budceler: hesab_mebleqi sütunu
    `ALTER TABLE budceler ADD COLUMN IF NOT EXISTS hesab_mebleqi NUMERIC(10,2) DEFAULT 0.00`,
    // bildirisler: is_read sütunu (notifications read flag)
    `ALTER TABLE bildirisler ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`,
  ];

  for (const sql of migrations) {
    try {
      await executeQuery(sql);
      console.log('Migration OK:', sql.slice(0, 60) + '...');
    } catch (err) {
      console.error('Migration failed:', err.message, '| SQL:', sql.slice(0, 80));
    }
  }
  try {
    await executeQuery(`ALTER TABLE istifadeciler ADD COLUMN IF NOT EXISTS password VARCHAR(200)`);
    console.log('Database schema initialization: password column ensured.');
  } catch (err) {
    console.error('Failed to initialize istifadeciler table column password:', err.message);
  }
  try {
    await executeQuery(`ALTER TABLE odenis_metodlari ADD COLUMN IF NOT EXISTS pan VARCHAR(19)`);
    console.log('Database schema initialization: pan column ensured.');
  } catch (err) {
    console.error('Failed to initialize odenis_metodlari table column pan:', err.message);
  }
  try {
    await executeQuery(`ALTER TABLE istifadeciler ADD COLUMN IF NOT EXISTS username VARCHAR(50)`);
    console.log('Database schema initialization: username column ensured.');
  } catch (err) {
    console.error('Failed to initialize istifadeciler table column username:', err.message);
  }
}

initDatabase().then(() => {
  startDueSubscriptionNotifierJob();
  app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
    console.log(`Swagger documentation is available on http://localhost:${PORT}/api-docs`);
  });
});
