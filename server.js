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
      version: '1.2.0',
      description: 'PostgreSQL verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı. Bütün istifadəçi-aid endpointlər "username" üzərindən işləyir.',
    },
    servers: [
      { url: '/', description: 'Cari Server (Lokal və ya Tunel)' },
      { url: `http://localhost:${PORT}`, description: 'Yerli API Serveri' },
    ],
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic', description: 'API-ya giriş üçün istifadəçi adı və şifrə daxil edin.' }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            code: { type: 'integer' },
            message: { type: 'string' },
            data: { type: 'object', nullable: true },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        },
        AccountNotFoundError: {
          allOf: [
            { $ref: '#/components/schemas/ErrorResponse' },
            {
              example: {
                code: 404,
                message: 'Not Found',
                data: null,
                error: {
                  code: 'ACCOUNT_NOT_FOUND',
                  message: 'Application account not found or credentials are incorrect.'
                }
              }
            }
          ]
        },
        PaymentMethodInUseError: {
          allOf: [
            { $ref: '#/components/schemas/ErrorResponse' },
            {
              example: {
                code: 409,
                message: 'Conflict',
                data: null,
                error: {
                  code: 'PAYMENT_METHOD_IN_USE',
                  message: 'This payment method is linked to active subscriptions.'
                }
              }
            }
          ]
        },
        InvalidCardPrefixError: {
          allOf: [
            { $ref: '#/components/schemas/ErrorResponse' },
            {
              example: {
                code: 400,
                message: 'Bad Request',
                data: null,
                error: {
                  code: 'INVALID_CARD_PREFIX',
                  message: 'Unsupported or invalid card number.'
                }
              }
            }
          ]
        }
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

// ── Helpers ──────────────────────────────────────────────────────────────────
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
// Format və "müddət bitib" yoxlamaları AYRI nəticələrlə qaytarılır ki,
// hansı xəta mesajının göstəriləcəyi dəqiq müəyyən olunsun.
// Format yoxlanışı üçün heç bir aralıq tətbiq etmir (00-99 hamısı format
// baxımından düzgündür) — ilin keçmiş olub-olmaması yalnız aşağıdaki
// "müddət bitib" addımında həll olunur, formatla qarışdırılmır.
function isValidKartTarixi(tarixi) {
  if (!tarixi) return { valid: true };

  // 1) Format yoxlanışı — Ay: 01-12, İl: hər iki rəqəm (00-99)
  const formatRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
  if (!formatRegex.test(tarixi)) {
    return { valid: false, reason: 'FORMAT' };
  }

  // 2) Format düzgündürsə, müddətin bitib-bitmədiyini yoxla
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

// İstifadəçinin username-inə görə daxili (PostgreSQL) ID-sini tapır.
// Bütün API endpointləri istifadəçini "username" ilə qəbul edir, daxili sorğularda isə FK üçün bu ID istifadə olunur.
async function getUserIdByUsername(username) {
  if (!username) return null;
  const result = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });
  if (result.rows.length === 0) return null;
  return result.rows[0].ID;
}

// baslama_tarixi və odenis_tezliyi-nə əsasən növbəti ödəniş tarixini avtomatik hesablayır.
// Bu sahə heç vaxt birbaşa client tərəfindən göndərilir, həmişə server tərəfindən default olaraq hesablanır.
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
      `INSERT INTO bildirisler (istifadeci_id, abunelik_id, basliq, mesaj, is_read) VALUES (:istifadeci_id, :abunelik_id, :basliq, :mesaj, FALSE)`,
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

// ── Subscription Account Validation (Mock) ─────────────────────────────────────
// Mock validation for subscription accounts (Netflix, etc.)
// Credentials are NOT saved to database, only used for validation
async function validateSubscriptionAccount(appAd, accountEmail, accountPassword) {
  // Mock validation logic
  const mockAccounts = {
    'netflix': { email: 'netflix@test.com', password: '123456' },
    'spotify': { email: 'spotify@test.com', password: '123456' },
    'youtube': { email: 'youtube@test.com', password: '123456' },
    'disney': { email: 'disney@test.com', password: '123456' },
    'hbo': { email: 'hbo@test.com', password: '123456' },
    'apple': { email: 'apple@test.com', password: '123456' },
    'amazon': { email: 'amazon@test.com', password: '123456' }
  };

  const appKey = appAd.toLowerCase();
  const mockAccount = mockAccounts[appKey];

  if (!mockAccount) {
    // If no mock account exists for this app, accept any credentials
    return true;
  }

  return accountEmail === mockAccount.email && accountPassword === mockAccount.password;
}

// ── Card Brand Detection ───────────────────────────────────────────────────────
// Automatically detect card brand from card number prefix
function detectCardBrand(pan) {
  const cleaned = String(pan).replace(/\s/g, '');
  
  if (cleaned.startsWith('4')) {
    return 'visa';
  }
  
  if (cleaned.startsWith('51') || cleaned.startsWith('52') || cleaned.startsWith('53') || 
      cleaned.startsWith('54') || cleaned.startsWith('55')) {
    return 'mastercard';
  }
  
  // Optional: Extended Mastercard range
  if (cleaned.length >= 4) {
    const prefix = parseInt(cleaned.substring(0, 4));
    if (prefix >= 2221 && prefix <= 2720) {
      return 'mastercard';
    }
  }
  
  return null; // Unsupported card brand
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

  if (trimmedUsername.length === 0 || trimmedAd.length === 0 || trimmedEmail.length === 0 || trimmedPassword.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'username, ad, email və password sahələri boş qoyula bilməz.');
  if (!isValidUsername(trimmedUsername)) return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığında olmalıdır.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (trimmedPassword.length < 6 || trimmedPassword.length > 72) return errorResponse(res, 400, 'Bad Request', 'INVALID_PASSWORD_LENGTH', 'Şifrə ən azı 6 və ən çoxu 72 simvoldan ibarət olmalıdır.');

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
    if (!isValidUsername(trimmedYeniUsername)) return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığında olmalıdır.');
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
 *               - accountemail
 *               - accountpassword
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
 *               accountemail:
 *                 type: string
 *                 example: netflix@test.com
 *                 description: Abunəlik hesab email ünvanı (yalnız validation üçün, yadda saxlanılmır)
 *               accountpassword:
 *                 type: string
 *                 example: "123456"
 *                 description: Abunəlik hesab şifrəsi (yalnız validation üçün, yadda saxlanılmır)
 *               odenis_metodu_id:
 *                 type: integer
 *                 example: 1
 *                 description: Ödəniş metodu ID-si
 *     responses:
 *       201:
 *         description: Abunəlik əlavə edildi
 *       400:
 *         description: Validation xətası
 *       404:
 *         description: Abunəlik hesabı tapılmadı
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AccountNotFoundError'
 */
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

app.post('/api/abunelikler', async (req, res) => {
  const { username, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya, odenis_metodu_id, accountemail, accountpassword } = req.body;

  if (!username || !ad || qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (username, ad, qiymet, baslama_tarixi) doldurun.');

  // Validate subscription account credentials
  if (!accountemail || !accountpassword) {
    return errorResponse(res, 400, 'Bad Request', 'MISSING_ACCOUNT_CREDENTIALS', 'accountemail və accountpassword sahələri məcburidir.');
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

    // Validate subscription account credentials (mock validation)
    const isValidAccount = await validateSubscriptionAccount(ad, accountemail, accountpassword);
    if (!isValidAccount) {
      return errorResponse(res, 404, 'Not Found', 'ACCOUNT_NOT_FOUND', 'Application account not found or credentials are incorrect.');
    }

    // ─── Ödəniş metodu (kart) MƏCBURİDİR ───────────────────────────────────
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

    // ─── Büdcə limiti yoxlaması (büdcə yoxdursa belə, 300 AZN defolt limit tətbiq olunur) ──
    const budgetRow = await executeQuery(
      `SELECT b.limit_mebleq, b.valyuta FROM budceler b WHERE b.istifadeci_id = :userId`,
      { userId }
    );

    {
      const budgetLimit   = budgetRow.rows.length > 0 ? Number(budgetRow.rows[0].LIMIT_MEBLEQ) : 300;
      const budgetValyuta = budgetRow.rows.length > 0 ? (budgetRow.rows[0].VALYUTA || 'AZN') : 'AZN';

      // Mövcud aktiv abunəliklərin qiymətlərini sadəcə topla (tezlik çevrilməsi yoxdur)
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
 * /api/abunelikler:
 *   put:
 *     summary: Abunəliyi username və mövcud abunəlik adına görə yeniləyir
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: ad
 *         required: true
 *         schema:
 *           type: string
 *         description: Yenilənəcək abunəliyin HAZIRKI adı
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - qiymet
 *               - baslama_tarixi
 *               - accountemail
 *               - accountpassword
 *             properties:
 *               ad:
 *                 type: string
 *               qiymet:
 *                 type: number
 *               valyuta:
 *                 type: string
 *               odenis_tezliyi:
 *                 type: string
 *               baslama_tarixi:
 *                 type: string
 *                 format: date
 *               kateqoriya:
 *                 type: string
 *               status:
 *                 type: string
 *               accountemail:
 *                 type: string
 *                 description: Abunəlik hesab email ünvanı (yalnız validation üçün, yadda saxlanılmır)
 *               accountpassword:
 *                 type: string
 *                 description: Abunəlik hesab şifrəsi (yalnız validation üçün, yadda saxlanılmır)
 *               odenis_metodu_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       400:
 *         description: Səhv sorğu və ya büdcə limiti keçildi
 *       404:
 *         description: Tapılmadı
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AccountNotFoundError'
 */
app.put('/api/abunelikler', async (req, res) => {
  const { username, ad: queryAd } = req.query;
  if (!username || !queryAd)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username və ad query parametrləri məcburidir.');

  const { ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya, status, odenis_metodu_id, accountemail, accountpassword } = req.body;

  if (qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'qiymet və baslama_tarixi məcburidir.');

  // Validate subscription account credentials
  if (!accountemail || !accountpassword) {
    return errorResponse(res, 400, 'Bad Request', 'MISSING_ACCOUNT_CREDENTIALS', 'accountemail və accountpassword sahələri məcburidir.');
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
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Tarix formatı yanlışdır: "${baslama_tarixi}" (Format: YYYY-MM-DD).`);

  if (kateqoriya && !ICAZE_VERILEN_KATEQORIYALAR.includes(kateqoriya))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CATEGORY', `Yanlış kateqoriya: "${kateqoriya}". Yalnız ${ICAZE_VERILEN_KATEQORIYALAR.join(', ')} daxil edilə bilər.`);

  const statusValue = status || 'active';
  if (!ICAZE_VERILEN_STATUSLAR.includes(statusValue))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_STATUS', `Status yalnız "active" və ya "deactive" ola bilər.`);

  const novbetiOdenisTarixi = hesablaNovbetiOdenisTarixi(baslama_tarixi, odenisTezliyi);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const subCheck = await executeQuery(
      `SELECT id FROM abunelikler WHERE istifadeci_id = :istifadeci_id AND ad = :ad`,
      { istifadeci_id: userId, ad: queryAd }
    );
    if (subCheck.rows.length === 0)
      return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');

    // Validate subscription account credentials (mock validation)
    const isValidAccount = await validateSubscriptionAccount(queryAd, accountemail, accountpassword);
    if (!isValidAccount) {
      return errorResponse(res, 404, 'Not Found', 'ACCOUNT_NOT_FOUND', 'Application account not found or credentials are incorrect.');
    }

    // ─── Büdcə limiti yoxlaması (yalnız status "active" olacaqsa) ─────────
    if (statusValue === 'active') {
      const budgetRow = await executeQuery(
        `SELECT b.limit_mebleq, b.valyuta FROM budceler b WHERE b.istifadeci_id = :userId`,
        { userId }
      );

      {
        const budgetLimit   = budgetRow.rows.length > 0 ? Number(budgetRow.rows[0].LIMIT_MEBLEQ) : 300;
        const budgetValyuta = budgetRow.rows.length > 0 ? (budgetRow.rows[0].VALYUTA || 'AZN') : 'AZN';

        const activeSubs = await executeQuery(
          `SELECT qiymet FROM abunelikler
            WHERE istifadeci_id = :userId AND status = 'active' AND id != :subId`,
          { userId, subId: subCheck.rows[0].ID }
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
            `Digər aktiv abunəliklər: ${currentTotal.toFixed(2)} ${budgetValyuta}, ` +
            `yenilənən abunəlik: +${parsedQiymet.toFixed(2)} ${budgetValyuta}, ` +
            `cəmi: ${projectedTotal.toFixed(2)} ${budgetValyuta} — limit: ${budgetLimit.toFixed(2)} ${budgetValyuta}. ` +
            `(Qalan boş büdcə: ${remaining.toFixed(2)} ${budgetValyuta})` 
          );
        }
      }
    }

    let finalOdenisMetoduId = null;
    if (odenis_metodu_id !== undefined && odenis_metodu_id !== null && odenis_metodu_id !== '') {
      finalOdenisMetoduId = Number(odenis_metodu_id);
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
    }

    const finalAd = ad || queryAd;
    await executeQuery(
      `UPDATE abunelikler SET ad=:ad, qiymet=:qiymet, valyuta=:valyuta, odenis_tezliyi=:odenis_tezliyi,
       baslama_tarixi=:baslama_tarixi::DATE, novbeti_odenis_tarixi=:novbeti_odenis_tarixi::DATE,
       kateqoriya=:kateqoriya, status=:status, odenis_metodu_id=:odenis_metodu_id
       WHERE istifadeci_id=:istifadeci_id AND ad=:queryAd`,
      {
        ad: finalAd, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta),
        odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi: novbetiOdenisTarixi,
        kateqoriya: kateqoriya || null, status: statusValue, odenis_metodu_id: finalOdenisMetoduId,
        istifadeci_id: userId, queryAd
      },
      { autoCommit: true }
    );

    await syncBudgetSpent(userId);

    return successResponse(res, 200, 'Updated', {
      message: 'Abunəlik uğurla yeniləndi.',
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
             b.basliq, b.mesaj, b.is_read,
             b.abunelik_id, a.ad AS app_adi, a.odenis_tezliyi,
             TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') AS novbeti_odenis_tarixi,
             TO_CHAR(b.gonderilme_tarixi, 'YYYY-MM-DD') AS gonderilme_tarixi
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
          is_read: row.IS_READ || false,
          gonderilme_tarixi: row.GONDERILME_TARIXI
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
        is_read: row.IS_READ || false,
        gonderilme_tarixi: finalGonderilmeTarixi
      };
    });

    return successResponse(res, 200, 'Success', { notifications });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/bildirisler/{id}/read:
 *   patch:
 *     summary: Bildirişi oxunmuş kimi işarə edir
 *     tags: [Bildirişlər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bildiriş oxunmuş kimi işarə edildi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: Updated
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Bildiriş oxunmuş kimi işarə edildi.
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.patch('/api/bildirisler/:id/read', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(
      `UPDATE bildirisler SET is_read = TRUE WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    return successResponse(res, 200, 'Updated', { message: 'Bildiriş oxunmuş kimi işarə edildi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
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
 *       400:
 *         description: username göndərilmədi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/odenis-metodlari', async (req, res) => {
  console.log('🔵 ========== KARTLARI GET ==========');
  const { username } = req.query;
  if (!username) {
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  }
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) {
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    }
    // SADƏCƏ MÖVCUD COLUMN-LARI SEÇ - yaradilma_tarixi OLMADAN
    const sql = `SELECT id, ad, kart_tipi, pan, kart_istifade_tarixi FROM odenis_metodlari WHERE istifadeci_id = ${userId}`;
    console.log('🔵 SQL:', sql);
    const result = await executeQuery(sql);
    console.log('🔵 Rows:', result.rows.length);
    const cards = result.rows.map(row => ({
      card_id: row.id || row.ID,
      ad: row.ad || row.AD || 'Adsız Kart',
      kart_tipi: row.kart_tipi || row.KART_TIPI || 'visa',
      pan: row.pan || row.PAN || '',
      kart_istifade_tarixi: row.kart_istifade_tarixi || row.KART_ISTIFADE_TARIXI || ''
    }));
    return successResponse(res, 200, 'Success', { cards });
  } catch (err) {
    console.error('❌ Xəta:', err.message);
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});
// =============================================
// --- ODENIS METODLARI (Payment Methods) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/odenis-metodlari:
 *   post:
 *     summary: Yeni ödəniş metodu əlavə edir (kart tipi avtomatik aşkar edilir)
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
 *               - kart_istifade_tarixi
 *               - cvv
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               ad:
 *                 type: string
 *                 example: "Əsas Kart"
 *               pan:
 *                 type: string
 *                 example: "4111111111111111"
 *                 description: Kart nömrəsi (kart tipi avtomatik aşkar edilir)
 *               kart_istifade_tarixi:
 *                 type: string
 *                 example: "12/28"
 *                 description: Son istifadə tarixi (MM/YY formatı)
 *               cvv:
 *                 type: string
 *                 example: "123"
 *                 description: CVV kodu (3 rəqəm) - YALNIZ VALİDASİYA ÜÇÜN, SAXLANILMIR
 *     responses:
 *       201:
 *         description: Ödəniş metodu əlavə edildi
 *       400:
 *         description: Validation xətası
 */
app.post('/api/odenis-metodlari', async (req, res) => {
  console.log('🔵 ========== KART ƏLAVƏ ETMƏ SORĞUSU ==========');
  console.log('🔵 Request body:', JSON.stringify(req.body, null, 2));
  
  const { username, ad, pan, kart_istifade_tarixi, cvv } = req.body;

  // 1. Sahələrin yoxlanılması
  if (!username || !ad || !pan || !kart_istifade_tarixi || !cvv) {
    console.log('❌ Sahələr çatışmır:', { 
      username: !!username, 
      ad: !!ad, 
      pan: !!pan, 
      kart_istifade_tarixi: !!kart_istifade_tarixi, 
      cvv: !!cvv 
    });
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad, pan, kart_istifade_tarixi və cvv sahələri məcburidir.');
  }

  const trimmedAd = String(ad).trim();
  const trimmedPan = String(pan).replace(/\s/g, '');
  const trimmedExpiry = String(kart_istifade_tarixi).trim();
  const trimmedCvv = String(cvv).trim();

  console.log('🔵 Təmizlənmiş məlumatlar:', {
    ad: trimmedAd,
    pan: trimmedPan ? trimmedPan.substring(0,4) + '****' + trimmedPan.slice(-4) : null,
    expiry: trimmedExpiry,
    cvv: trimmedCvv ? '***' : null
  });

  // 2. Boş sahələrin yoxlanılması
  if (trimmedAd.length === 0 || trimmedPan.length === 0 || trimmedExpiry.length === 0 || trimmedCvv.length === 0) {
    console.log('❌ Boş sahələr var');
    return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'Bütün sahələr boş qoyula bilməz.');
  }

  // 3. Kart brendinin avtomatik aşkarlanması
  const detectedBrand = detectCardBrand(trimmedPan);
  console.log('🔵 Aşkarlanan brend:', detectedBrand);
  
  if (!detectedBrand) {
    console.log('❌ Dəstəklənməyən kart prefixi:', trimmedPan.substring(0, 4));
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_PREFIX', 'Unsupported or invalid card number.');
  }

  // 4. Luhn alqoritmi ilə PAN yoxlanışı
  const isLuhnValid = isValidPanLuhn(trimmedPan);
  console.log('🔵 Luhn yoxlaması:', isLuhnValid);
  
  if (!isLuhnValid) {
    console.log('❌ Luhn yoxlaması uğursuz');
    return errorResponse(res, 400, 'Bad Request', 'INVALID_PAN', 'Kart nömrəsi düzgün deyil (Luhn yoxlaması uğursuz).');
  }

  // 5. Son istifadə tarixinin yoxlanılması
  const expiryCheck = isValidKartTarixi(trimmedExpiry);
  console.log('🔵 Son istifadə tarixi yoxlaması:', expiryCheck);
  
  if (!expiryCheck.valid) {
    if (expiryCheck.reason === 'FORMAT') {
      return errorResponse(res, 400, 'Bad Request', 'INVALID_EXPIRY_FORMAT', 'Son istifadə tarixi formatı yanlışdır (MM/YY).');
    } else if (expiryCheck.reason === 'EXPIRED') {
      return errorResponse(res, 400, 'Bad Request', 'CARD_EXPIRED', 'Kartın müddəti bitib.');
    }
  }

  // 6. CVV yoxlanışı (yalnız format, database-də saxlanılmır)
  if (!/^\d{3}$/.test(trimmedCvv)) {
    console.log('❌ CVV formatı yanlışdır:', trimmedCvv);
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CVV', 'CVV yalnız 3 rəqəmdən ibarət olmalıdır.');
  }

  try {
    // 7. İstifadəçi ID-nin tapılması
    const userId = await getUserIdByUsername(username);
    console.log('🔵 İstifadəçi ID:', userId);
    
    if (userId === null) {
      console.log('❌ İstifadəçi tapılmadı:', username);
      return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    }

    // 8. Database-ə əlavə etmə (CVV SAXLANILMIR)
    const sql = `INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, pan, kart_istifade_tarixi)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`;
    
    const values = [
      userId,
      trimmedAd,
      detectedBrand,
      trimmedPan,
      trimmedExpiry
    ];
    
    console.log('🔵 SQL:', sql);
    console.log('🔵 Values:', {
      istifadeci_id: values[0],
      ad: values[1],
      kart_tipi: values[2],
      pan: values[3] ? values[3].substring(0,4) + '****' + values[3].slice(-4) : null,
      kart_istifade_tarixi: values[4]
    });

    const result = await executeQuery(sql, values, { autoCommit: true });
    console.log('🔵 Insert nəticəsi:', result);
    
    if (result.rows && result.rows.length > 0) {
      console.log('✅ Kart uğurla əlavə edildi. ID:', result.rows[0].ID);
      return successResponse(res, 201, 'Created', { 
        message: 'Ödəniş metodu uğurla əlavə edildi.',
        card_id: result.rows[0].ID
      });
    } else {
      console.log('❌ Kart əlavə edilərkən ID qaytarılmadı');
      return successResponse(res, 201, 'Created', { message: 'Ödəniş metodu uğurla əlavə edildi.' });
    }
  } catch (err) {
    console.error('❌ Xəta:', err.message);
    console.error('❌ Xəta detalı:', err.stack);
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});
/**
 * @swagger
 * /api/odenis-metodlari/{id}:
 *   delete:
 *     summary: Ödəniş metodunu silir
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
 *         description: Ödəniş metodu aktiv abunəliklərdə istifadə olunur
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentMethodInUseError'
 */
app.delete('/api/odenis-metodlari/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if payment method is used by any subscription
    const usageCheck = await executeQuery(
      `SELECT id FROM abunelikler WHERE odenis_metodu_id = :id`,
      { id }
    );
    if (usageCheck.rows.length > 0) {
      return errorResponse(res, 409, 'Conflict', 'PAYMENT_METHOD_IN_USE', 'This payment method is linked to active subscriptions.');
    }

    const result = await executeQuery(
      `DELETE FROM odenis_metodlari WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'PAYMENT_METHOD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Ödəniş metodu uğurla silindi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- ODENIS TARIXCESI (Payment History) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/odenis-tarixcesi:
 *   get:
 *     summary: İstifadəçinin bütün ödəniş tarixçəsini siyahılayır (username ilə)
 *     tags: [Ödəniş Tarixçəsi]
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
app.get('/api/odenis-tarixcesi', async (req, res) => {
  console.log('🔵 ========== TARİXÇƏ GET ==========');
  const { username } = req.query;
  if (!username) {
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  }
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) {
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    }
    
    // Əvvəlcə cədvəlin strukturunu yoxlayaq - SADƏ SORĞU
    const sql = `SELECT * FROM odenis_tarixcesi WHERE istifadeci_id = ${userId} LIMIT 10`;
    console.log('🔵 SQL:', sql);
    const result = await executeQuery(sql);
    console.log('🔵 Rows:', result.rows.length);
    
    // Əgər məlumat yoxdursa, boş array qaytar
    if (result.rows.length === 0) {
      return successResponse(res, 200, 'No payment history', { paymenthistory: [] });
    }
    
    // Məlumatları formatla
    const history = result.rows.map(row => ({
      history_id: row.id || row.ID,
      app_adi: row.app_adi || 'Unknown',
      mebleq: row.mebleq || 0,
      valyuta: row.valyuta || 'AZN',
      status: row.status || 'success',
      odenis_tarixi: row.odenis_tarixi || row.ODENIS_TARIXI || new Date().toISOString().split('T')[0],
      kateqoriya: row.kateqoriya || 'Other'
    }));
    
    return successResponse(res, 200, 'Success', { paymenthistory: history });
  } catch (err) {
    console.error('❌ Xəta:', err.message);
    console.error('❌ Stack:', err.stack);
    return successResponse(res, 200, 'No payment history', { paymenthistory: [] });
  }
});

// =============================================
// --- AYARLAR (Settings) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/ayarlar/{username}:
 *   get:
 *     summary: İstifadəçi ayarlarını gətirir
 *     tags: [Ayarlar]
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
app.get('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `
      SELECT esas_valyuta, bildiris_metodu, dil, tema, tema_rengi
      FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id
    `;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No settings found', { settings: null });
    return successResponse(res, 200, 'Success', { settings: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/ayarlar/{username}:
 *   put:
 *     summary: İstifadəçi ayarlarını yeniləyir
 *     tags: [Ayarlar]
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
 *             properties:
 *               esas_valyuta:
 *                 type: string
 *                 enum: [AZN, USD, EUR]
 *                 example: AZN
 *               bildiris_metodu:
 *                 type: string
 *                 enum: [email, telegram]
 *                 example: email
 *               dil:
 *                 type: string
 *                 example: az
 *               tema:
 *                 type: string
 *                 enum: [light, dark]
 *                 example: dark
 *               tema_rengi:
 *                 type: string
 *                 enum: [gold, teal, coral, purple, blue]
 *                 example: gold
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.put('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  const { esas_valyuta, bildiris_metodu, dil, tema, tema_rengi } = req.body;
  const ICAZE_VERILEN_VALYUTALAR_L = ['AZN', 'USD', 'EUR'];
  const ICAZE_VERILEN_BILDIRISLER  = ['email', 'telegram'];
  const ICAZE_VERILEN_TEMALAR      = ['light', 'dark'];
  const ICAZE_VERILEN_TEMA_RENGLERI = ['gold', 'teal', 'coral', 'purple', 'blue'];
  const ICAZE_VERILEN_DILLER = ['az','en','ru','tr','de','fr','es','it','pt','ar','zh','ja','ko','hi','nl','pl','sv','no','da','fi','cs','sk','ro','hu','uk','ka','kk','uz','hy','fa','he','id','ms','th','vi','el','bg','hr','sr','lt','lv','et','sl','sq','mk','bs','is','ga','cy','eu','ca','gl','mt','af','sw','tl','bn','ur','ta','te','kn','ml','si','my','km','lo','mn','ne','ps','so','am','ha','yo','ig'];

  if (esas_valyuta && !ICAZE_VERILEN_VALYUTALAR_L.includes(esas_valyuta.toUpperCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${esas_valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR_L.join(', ')} daxil edilə bilər.`);
  if (bildiris_metodu && !ICAZE_VERILEN_BILDIRISLER.includes(bildiris_metodu.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_NOTIFICATION_METHOD', `Yanlış bildiriş metodu: "${bildiris_metodu}". Yalnız ${ICAZE_VERILEN_BILDIRISLER.join(', ')} daxil edilə bilər.`);
  if (tema && !ICAZE_VERILEN_TEMALAR.includes(tema.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME', `Yanlış tema: "${tema}". Yalnız ${ICAZE_VERILEN_TEMALAR.join(', ')} daxil edilə bilər.`);
  if (tema_rengi && !ICAZE_VERILEN_TEMA_RENGLERI.includes(tema_rengi.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME_COLOR', `Yanlış tema rəngi: "${tema_rengi}". Yalnız ${ICAZE_VERILEN_TEMA_RENGLERI.join(', ')} daxil edilə bilər.`);
  if (dil && !ICAZE_VERILEN_DILLER.includes(dil.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_LANGUAGE', `Yanlış dil kodu: "${dil}". ISO 639-1 formatında olmalıdır.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    await executeQuery(
      `UPDATE istifadeci_ayarlari
       SET esas_valyuta = :esas_valyuta, bildiris_metodu = :bildiris_metodu, dil = :dil, tema = :tema, tema_rengi = :tema_rengi
       WHERE istifadeci_id = :istifadeci_id`,
      {
        esas_valyuta, bildiris_metodu, dil, tema, tema_rengi, istifadeci_id: userId
      },
      { autoCommit: true }
    );

    return successResponse(res, 200, 'Updated', { message: 'Ayarlar uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- BUDCELER (Budget) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/budceler/{username}:
 *   get:
 *     summary: İstifadəçi büdcəsini gətirir
 *     tags: [Büdcə]
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
app.get('/api/budceler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const sql = `
      SELECT limit_mebleq, valyuta, hesab_mebleqi
      FROM budceler WHERE istifadeci_id = :istifadeci_id
    `;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) return successResponse(res, 200, 'No budget found', { budget: null });
    return successResponse(res, 200, 'Success', { budget: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/budceler:
 *   post:
 *     summary: Yeni büdcə əlavə edir
 *     tags: [Büdcə]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - limit_mebleq
 *             properties:
 *               username:
 *                 type: string
 *               limit_mebleq:
 *                 type: number
 *               valyuta:
 *                 type: string
 *     responses:
 *       201:
 *         description: Büdcə yaradıldı
 *       400:
 *         description: Mövcud abunəlik xərcləri limit məbləğindən çoxdur və ya digər yoxlama xətası
 */
app.post('/api/budceler', async (req, res) => {
  const { username, limit_mebleq, valyuta, hesab_mebleqi } = req.body;

  if (!username || limit_mebleq === undefined || limit_mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username və limit_mebleq sahələri məcburidir.');

  const parsedLimit = Number(limit_mebleq);
  if (isNaN(parsedLimit) || parsedLimit <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'Limit 0-dan böyük olmalıdır.');

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    // Mövcud aktiv abunəliklərin qiymətlərini toplayırıq
    const activeSubs = await executeQuery(
      `SELECT qiymet FROM abunelikler WHERE istifadeci_id = :userId AND status = 'active'`,
      { userId }
    );

    let totalSpend = 0;
    for (const row of activeSubs.rows) {
      totalSpend += Number(row.QIYMET);
    }

    if (totalSpend > parsedLimit) {
      return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED',
        `Mövcud abunəlik xərcləri (${totalSpend.toFixed(2)}) yeni limitdən (${parsedLimit.toFixed(2)}) çoxdur. Zəhmət olmasa limit məbləğini artırın.`);
    }

    await executeQuery(
      `INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, hesab_mebleqi)
       VALUES (:istifadeci_id, :limit_mebleq, :valyuta, :hesab_mebleqi)`,
      {
        istifadeci_id: userId,
        limit_mebleq: parsedLimit,
        valyuta: valyuta || 'AZN',
        hesab_mebleqi: totalSpend
      },
      { autoCommit: true }
    );

    return successResponse(res, 201, 'Created', { message: 'Büdcə uğurla yaradıldı.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/budceler/{username}:
 *   put:
 *     summary: Büdcəni yeniləyir
 *     tags: [Büdcə]
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
 *             properties:
 *               limit_mebleq:
 *                 type: number
 *               valyuta:
 *                 type: string
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       400:
 *         description: Mövcud abunəlik xərcləri limit məbləğindən çoxdur və ya digər yoxlama xətası
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.put('/api/budceler/:username', async (req, res) => {
  const { username } = req.params;
  const { limit_mebleq, valyuta, hesab_mebleqi } = req.body;

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const parsedLimit = Number(limit_mebleq);
    if (isNaN(parsedLimit) || parsedLimit <= 0)
      return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'Limit 0-dan böyük olmalıdır.');

    // Mövcud aktiv abunəliklərin qiymətlərini toplayırıq
    const activeSubs = await executeQuery(
      `SELECT qiymet FROM abunelikler WHERE istifadeci_id = :userId AND status = 'active'`,
      { userId }
    );

    let totalSpend = 0;
    for (const row of activeSubs.rows) {
      totalSpend += Number(row.QIYMET);
    }

    if (totalSpend > parsedLimit) {
      return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED',
        `Mövcud abunəlik xərcləri (${totalSpend.toFixed(2)}) yeni limitdən (${parsedLimit.toFixed(2)}) çoxdur. Zəhmət olmasa limit məbləğini artırın.`);
    }

    await executeQuery(
      `UPDATE budceler
       SET limit_mebleq = :limit_mebleq, valyuta = :valyuta, hesab_mebleqi = :hesab_mebleqi
       WHERE istifadeci_id = :istifadeci_id`,
      {
        limit_mebleq: parsedLimit, valyuta: valyuta || 'AZN', hesab_mebleqi: totalSpend, istifadeci_id: userId
      },
      { autoCommit: true }
    );

    return successResponse(res, 200, 'Updated', { message: 'Büdcə uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startDueSubscriptionNotifierJob();
});
