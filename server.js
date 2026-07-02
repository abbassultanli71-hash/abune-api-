const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { executeQuery } = require('./db');
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
      description: 'Oracle verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı. Bütün istifadəçi-aid endpointlər "username" üzərindən işləyir.',
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
app.use('/api-docs', authMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use('/api', authMiddleware);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/app', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'app.html')); });

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
// Format yoxlanışı il üçün heç bir aralıq tətbiq etmir (00-99 hamısı format
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

// İstifadəçinin username-inə görə daxili (Oracle) ID-sini tapır.
// Bütün API endpointləri istifadəçini "username" ilə qəbul edir, daxili sorğularda isə FK üçün bu ID istifadə olunur.
async function getUserIdByUsername(username) {
  if (!username) return null;
  const result = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });
  if (result.rows.length === 0) return null;
  return result.rows[0].ID;
}

// baslama_tarixi və odenis_tezliyi-nə əsasən növbəti ödəniş tarixini avtomatik hesablayır.
// Bu sahə heç vaxt birbaşa client tərəfindən göndərilmir, həmişə server tərəfindən default olaraq hesablanır.
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
 *     responses:
 *       201:
 *         description: İstifadəçi yaradıldı
 */
app.post('/api/istifadeciler', async (req, res) => {
  const { username, ad, email } = req.body;

  if (!username || !ad || !email) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad və email sahələri məcburidir.');

  const trimmedUsername = String(username).trim();
  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (trimmedUsername.length === 0 || trimmedAd.length === 0 || trimmedEmail.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'username, ad və email sahələri boş qoyula bilməz.');
  if (!isValidUsername(trimmedUsername)) return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığında olmalıdır.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');

  try {
    const usernameCheck = await executeQuery(`SELECT username FROM istifadeciler WHERE username = :username`, { username: trimmedUsername });
    if (usernameCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_USERNAME', 'Bu username ilə artıq istifadəçi mövcuddur.');

    const emailCheck = await executeQuery(`SELECT email FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    if (emailCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    await executeQuery(
      `INSERT INTO istifadeciler (username, ad, email) VALUES (:username, :ad, :email)`,
      { username: trimmedUsername, ad: trimmedAd, email: trimmedEmail },
      { autoCommit: true }
    );

    const userResult = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username: trimmedUsername });
    const userId = userResult.rows[0].ID;
    await executeQuery(
      `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:userId, 'AZN', 'email', 'az', 'dark')`,
      { userId }, { autoCommit: true }
    );
    return successResponse(res, 201, 'Created', { message: 'İstifadəçi və onun ilkin ayarları uğurla yaradıldı.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Məlumatların unikallığı pozuldu (eyni username və ya email artıq mövcuddur).');
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
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Bu email və ya username artıq mövcuddur.');
    if (err.message && err.message.includes('ORA-02292')) return errorResponse(res, 400, 'Bad Request', 'FK_CONSTRAINT', 'İstifadəçinin abunəliyi və ya bildirişi olduğu üçün username dəyişdirilə bilməz.');
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
             a.kateqoriya, a.status,
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
 *     responses:
 *       201:
 *         description: Abunəlik əlavə edildi (status avtomatik "active", novbeti_odenis_tarixi avtomatik hesablanır)
 */
app.post('/api/abunelikler', async (req, res) => {
  const { username, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya } = req.body;

  if (!username || !ad || qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (username, ad, qiymet, baslama_tarixi) doldurun.');

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

    const sql = `INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status)
                 VALUES (:istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'), :kateqoriya, 'active')`;
    const binds = {
      istifadeci_id: userId, ad, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta),
      odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi: novbetiOdenisTarixi,
      kateqoriya: kateqoriya || null
    };

    await executeQuery(sql, binds, { autoCommit: true });

    // Yeni yaranan abunəliyin ID-sini tap
    const newSub = await executeQuery(
      `SELECT id FROM abunelikler
       WHERE istifadeci_id = :istifadeci_id AND ad = :ad
       ORDER BY id DESC LIMIT 1`,
      { istifadeci_id: userId, ad }
    );
    const newSubId = newSub.rows.length > 0 ? newSub.rows[0].ID : null;

    // Avtomatik bildiriş əlavə et
    // Avtomatik bildiriş əlavə et
    await addAutoNotification(userId, newSubId, ad, novbetiOdenisTarixi);

    // Avtomatik ödəniş tarixçəsi əlavə et
    if (newSubId) {
      await addAutoPaymentHistory(userId, newSubId, parsedQiymet, baslama_tarixi);
    }

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
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       404:
 *         description: Tapılmadı
 */
app.put('/api/abunelikler', async (req, res) => {
  const { username, ad: queryAd } = req.query;
  if (!username || !queryAd)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username və ad query parametrləri məcburidir.');

  const { ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya, status } = req.body;

  if (qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'qiymet və baslama_tarixi məcburidir.');

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

    const finalAd = ad || queryAd;
    await executeQuery(
      `UPDATE abunelikler SET ad=:ad, qiymet=:qiymet, valyuta=:valyuta, odenis_tezliyi=:odenis_tezliyi,
       baslama_tarixi=TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), novbeti_odenis_tarixi=TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'),
       kateqoriya=:kateqoriya, status=:status
       WHERE istifadeci_id=:istifadeci_id AND ad=:queryAd`,
      {
        ad: finalAd, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta),
        odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi: novbetiOdenisTarixi,
        kateqoriya: kateqoriya || null, status: statusValue,
        istifadeci_id: userId, queryAd
      },
      { autoCommit: true }
    );
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
 *                   example: Success
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           bildiris_id:
 *                             type: integer
 *                           username:
 *                             type: string
 *                           basliq:
 *                             type: string
 *                           mesaj:
 *                             type: string
 *                           gonderilme_tarixi:
 *                             type: string
 *                             format: date
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
 * /api/bildirisler/{id}:
 *   delete:
 *     summary: Bildirişi silir
 *     tags: [Bildirişlər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Bildiriş silindi
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.delete('/api/bildirisler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(
      `DELETE FROM bildirisler WHERE id = :id`,
      { id },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Bildiriş uğurla silindi.' });
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
 *     summary: >
 *       İstifadəçinin bütün ödəniş tarixçəsini siyahılayır (username ilə).
 *       Hər qeydin aid olduğu abunəlik adı (app_adi)
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentHistory:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           odenis_tarixcesi_id:
 *                             type: integer
 *                           abunelik_id:
 *                             type: integer
 *                           app_adi:
 *                             type: string
 *                           username:
 *                             type: string
 *                           odenis_tarixi:
 *                             type: string
 *                             format: datee
 *                           mebleq:
 *                             type: number
 *                           status:
 *                             type: string
 *                             enum: [success, fail]
 *       400:
 *         description: username göndərilmədi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/odenis-tarixcesi', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username sorğu parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    // app_adi (abunəliyin adı) və novbeti_odenis_tarixi da qaytarılır
    const sql = `
      SELECT o.id AS odenis_tarixcesi_id,
             o.abunelik_id,
             a.ad AS app_adi,
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




/**
 * @swagger
 * /api/odenis-tarixcesi:
 *   post:
 *     summary: >
 *       Yeni ödəniş tarixçəsi qeydi əlavə edir.
 *       ID avtomatik yaranır. abunelik_id mütləq həmin username-ə aid olmalıdır.
 *       odenis_tarixi abunəliyin novbeti_odenis_tarixi ilə eyni olmalıdır —
 *       əks halda xəta qaytarılır.
 *     tags: [Ödəniş Tarixçəsi]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - abunelik_id
 *               - username
 *               - mebleq
 *               - odenis_tarixi
 *             properties:
 *               abunelik_id:
 *                 type: integer
 *                 example: 3
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               odenis_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-01"
 *                 description: >
 *                   Abunəliyin novbeti_odenis_tarixi ilə eyni olmalıdır.
 *               mebleq:
 *                 type: number
 *                 example: 12.99
 *               status:
 *                 type: string
 *                 enum: [success, fail]
 *                 default: success
 *                 example: success
 *     responses:
 *       201:
 *         description: Əlavə edildi
 *       400:
 *         description: >
 *           odenis_tarixi novbeti_odenis_tarixi ilə uyğun gəlmir,
 *           abunəlik bu istifadəçiyə aid deyil, və s.
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.post('/api/odenis-tarixcesi', async (req, res) => {
  const { abunelik_id, username, odenis_tarixi, mebleq, status } = req.body;

  // Məcburi sahələr
  if (!abunelik_id || !username || !odenis_tarixi || mebleq === undefined || mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS',
      'Məcburi sahələri (abunelik_id, username, odenis_tarixi, mebleq) doldurun.');

  // Tarix formatı
  if (!isValidDate(odenis_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE',
      `Ödəniş tarixi düzgün deyil: "${odenis_tarixi}" (Format: YYYY-MM-DD).`);

  // Məbləğ
  const parsedMebleq = Number(mebleq);
  if (isNaN(parsedMebleq) || parsedMebleq <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_AMOUNT', 'Məbləğ 0-dan böyük olmalıdır.');

  // Status
  const statusValue = status || 'success';
  if (statusValue !== 'success' && statusValue !== 'fail')
    return errorResponse(res, 400, 'Bad Request', 'INVALID_STATUS',
      'Status yalnız "success" və ya "fail" ola bilər.');

  try {
    // İstifadəçi yoxlaması
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    // Abunəlik yoxlaması
    const subResult = await executeQuery(
      `SELECT id, istifadeci_id, ad,
              TO_CHAR(novbeti_odenis_tarixi, 'YYYY-MM-DD') AS novbeti_odenis_tarixi,
              status AS sub_status
       FROM abunelikler
       WHERE id = :abunelik_id`,
      { abunelik_id }
    );
    if (subResult.rows.length === 0)
      return errorResponse(res, 400, 'Bad Request', 'SUBSCRIPTION_NOT_FOUND',
        'Göstərilən abunelik_id ilə abunəlik tapılmadı.');

    const sub = subResult.rows[0];

    // Abunəlik bu istifadəçiyə aidmi?
    if (Number(sub.ISTIFADECI_ID) !== Number(userId))
      return errorResponse(res, 400, 'Bad Request', 'SUBSCRIPTION_USER_MISMATCH',
        `Bu abunəlik (ID: ${abunelik_id}) "${username}" istifadəçisinə aid deyil.`);

    // odenis_tarixi == novbeti_odenis_tarixi olmalıdır
    const novbetiTarix = sub.NOVBETI_ODENIS_TARIXI;
    if (odenis_tarixi !== novbetiTarix)
      return errorResponse(res, 400, 'Bad Request', 'DATE_MISMATCH',
        `Ödəniş tarixi ("${odenis_tarixi}") abunəliyin növbəti ödəniş tarixi ilə ("${novbetiTarix}") eyni olmalıdır. ` +
        `Zəhmət olmasa odenis_tarixi olaraq "${novbetiTarix}" daxil edin.`);

    // Qeydi əlavə et
    await executeQuery(
      `INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
       VALUES (:abunelik_id, :istifadeci_id, TO_DATE(:odenis_tarixi, 'YYYY-MM-DD'), :mebleq, :status)`,
      { abunelik_id, istifadeci_id: userId, odenis_tarixi, mebleq: parsedMebleq, status: statusValue },
      { autoCommit: true }
    );

    return successResponse(res, 201, 'Created', {
      message: 'Ödəniş tarixçəsi qeydi uğurla əlavə edildi.',
      app_adi: sub.AD,
      odenis_tarixi,
      mebleq: parsedMebleq,
      status: statusValue
    });
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
 * @swagger
 * /api/odenis-metodlari:
 *   post:
 *     summary: Yeni ödəniş metodu (kart) əlavə edir (username ilə)
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
 *               - kart_tipi
 *             properties:
 *               username:
 *                 type: string
 *                 example: abbas.abbasov
 *               ad:
 *                 type: string
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *                 example: Visa
*               pan:
 *                 type: string
 *                 example: "4169739000001234"
 *               cvv:
 *                 type: string
 *                 example: "123"
 *               kart_istifade_tarixi:
 *                 type: string
 *     responses:
 *       201:
 *         description: Əlavə edildi
 */
app.post('/api/odenis-metodlari', async (req, res) => {
  const { username, ad, kart_tipi, pan, cvv, kart_istifade_tarixi } = req.body;
  if (!username || !ad || !kart_tipi) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad və kart_tipi sahələri məcburidir.');
  if (pan && !isValidPanLuhn(pan)) {
  return errorResponse(res, 400, 'Bad Request', 'INVALID_PAN',
    'Kart nömrəsi (pan) düzgün deyil (Luhn yoxlamasından keçmədi).');
  }
  if (cvv !== undefined && cvv !== null && cvv !== '') {
  if (!/^\d{3}$/.test(String(cvv))) {
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CVV', 'cvv yalnız 3 rəqəmdən ibarət olmalıdır (məs: 123).');
  }
}

  // Kartın istifadə tarixi: əvvəlcə format, sonra (format düzgündürsə) müddət yoxlanılır.
  // İki ayrı xəta nəticəsi (FORMAT / EXPIRED) qarışdırılmadan göstərilir.
  if (kart_istifade_tarixi) {
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

  const ICAZE_VERILEN_KARTLAR = ['visa','mastercard'];
  const KART_FORMATLARI = { 'visa':'Visa','mastercard':'Mastercard'};
  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_TYPE', `Yanlış kart növü: "${kart_tipi}". Yalnız Visa, Mastercard`);

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
    kart_tipi: KART_FORMATLARI[normalizedKartTipi],
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
 *   put:
 *     summary: Ödəniş metodunu yeniləyir (status bu endpointdə dəyişdirilmir)
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ad
 *               - kart_tipi
 *             properties:
 *               ad:
 *                 type: string
 *                 example: Maaş Kartı
*               pan:
 *                 type: string
 *                 example: "4169739000001234"
 *               cvv:
 *                 type: string
 *                 example: "123"
 *               kart_istifade_tarixi:
 *                 type: string
 *                 example: "12/28"
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *                 example: Visa
 *     responses:
 *       200:
 *         description: Yeniləndi
 */
app.put('/api/odenis-metodlari/:id', async (req, res) => {
  const { id } = req.params;
  const { username, ad, kart_tipi, pan, cvv, kart_istifade_tarixi } = req.body;
  if (!ad || !kart_tipi) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'ad və kart_tipi sahələri məcburidir.');
  if (pan && !isValidPanLuhn(pan)) {
  return errorResponse(res, 400, 'Bad Request', 'INVALID_PAN',
    'Kart nömrəsi (pan) düzgün deyil (Luhn yoxlamasından keçmədi).');
  }
  if (cvv !== undefined && cvv !== null && cvv !== '') {
  if (!/^\d{3}$/.test(String(cvv))) {
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CVV', 'cvv yalnız 3 rəqəmdən ibarət olmalıdır (məs: 123).');
  }
}

  // Kartın istifadə tarixi: əvvəlcə format, sonra (format düzgündürsə) müddət yoxlanılır.
  // İki ayrı xəta nəticəsi (FORMAT / EXPIRED) qarışdırılmadan göstərilir.
  if (kart_istifade_tarixi) {
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

  const ICAZE_VERILEN_KARTLAR = ['visa','mastercard','maestro','unionpay','american express','amex','birkart','tamkart','bolkart','ucard'];
  const KART_FORMATLARI = { 'visa':'Visa','mastercard':'Mastercard','maestro':'Maestro','unionpay':'UnionPay','american express':'American Express','amex':'American Express','birkart':'Birkart','tamkart':'Tamkart','bolkart':'Bolkart','ucard':'Ucard' };
  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_TYPE', `Yanlış kart növü: "${kart_tipi}". Yalnız Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard icazəlidir.`);

  try {
    const result = await executeQuery(
  `UPDATE odenis_metodlari
   SET ad=:ad,
       kart_tipi=:kart_tipi,
       pan=:pan,
       kart_istifade_tarixi=:kart_istifade_tarixi
   WHERE id=:id`,
  {
    ad,
    kart_tipi: KART_FORMATLARI[normalizedKartTipi],
    pan,
    kart_istifade_tarixi: kart_istifade_tarixi || null,
    id
  },
  { autoCommit: true }
);
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
    return successResponse(res, 200, 'Updated', { message: 'Ödəniş metodu uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari/{id}:
 *   delete:
 *     summary: Ödəniş metodunu username və kart adına görə silir
 *     tags: [Ödəniş Metodları]
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
 *     responses:
 *       200:
 *         description: Silindi
 *       404:
 *         description: Tapılmadı
 */
app.delete('/api/odenis-metodlari', async (req, res) => {
  const { username, ad } = req.query;
  if (!username || !ad)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username və ad query parametrləri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
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

/**
 * @swagger
 * /api/budceler:
 *   get:
 *     summary: İstifadəçinin büdcə limitlərini siyahılayır (username ilə)
 *     tags: [Büdcələr]
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

/**
 * @swagger
 * /api/budceler:
 *   post:
 *     summary: Yeni büdcə limiti əlavə edir (hesabdakı məbləğ limitdən çox ola bilməz)
 *     tags: [Büdcələr]
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
 *                 example: abbas.abbasov
 *               limit_mebleq:
 *                 type: number
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               hesab_mebleqi:
 *                 type: number
 *                 example: 30.00
 *                 description: Hesabda hazırda olan/xərclənmiş məbləğ. limit_mebleq-dən çox ola bilməz.
 *     responses:
 *       201:
 *         description: Yaradıldı
 *       400:
 *         description: hesab_mebleqi limit_mebleq-dən çoxdur
 */
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

    // Eyni username ilə artıq büdcə varsa bloklayır
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

    // Yeni yaranan büdcənin ID-sini qaytarır
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

/**
 * @swagger
 * /api/budceler/{username}:
 *   put:
 *     tags: [Büdcələr]
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
 *             required: [limit_mebleq]
 *             properties:
 *               limit_mebleq:
 *                 type: number
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               hesab_mebleqi:
 *                 type: number
 *                 example: 40.00
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       400:
 *         description: hesab_mebleqi limit_mebleq-dən çoxdur
 */
// swagger-da da dəyiş: /api/budceler/{username}
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
/**
 * @swagger
 * /api/budceler/{username}:
 *   delete:
 *     summary: İstifadəçinin büdcəsini silir (username ilə)
 *     tags: [Büdcələr]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Büdcə silindi
 *       404:
 *         description: İstifadəçi və ya büdcə tapılmadı
 */
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

// =============================================
// --- AYARLAR (Settings) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/ayarlar/{username}:
 *   get:
 *     summary: İstifadəçinin fərdi ayarlarını gətirir (username ilə)
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

    const sql = `SELECT istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id: userId });
    if (result.rows.length === 0) {
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:istifadeci_id, 'AZN', 'email', 'az', 'dark')`,
        { istifadeci_id: userId }, { autoCommit: true }
      );
      return successResponse(res, 200, 'Success', { settings: { istifadeci_id: userId, username, esas_valyuta: 'AZN', bildiris_metodu: 'email', dil: 'az', tema: 'dark' } });
    }
    return successResponse(res, 200, 'Success', { settings: { ...result.rows[0], USERNAME: username } });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/ayarlar/{username}:
 *   put:
 *     summary: İstifadəçinin fərdi ayarlarını yeniləyir (username ilə)
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
 *     responses:
 *       200:
 *         description: Ayarlar yeniləndi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.put('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  const { esas_valyuta, bildiris_metodu, dil, tema } = req.body;
  const ICAZE_VERILEN_VALYUTALAR_L = ['AZN', 'USD', 'EUR'];
  const ICAZE_VERILEN_BILDIRISLER  = ['email', 'telegram'];
  const ICAZE_VERILEN_TEMALAR      = ['light', 'dark'];
  const ICAZE_VERILEN_DILLER = ['az','en','ru','tr','de','fr','es','it','pt','ar','zh','ja','ko','hi','nl','pl','sv','no','da','fi','cs','sk','ro','hu','uk','ka','kk','uz','hy','fa','he','id','ms','th','vi','el','bg','hr','sr','lt','lv','et','sl','sq','mk','bs','is','ga','cy','eu','ca','gl','mt','af','sw','tl','bn','ur','ta','te','kn','ml','si','my','km','lo','mn','ne','ps','so','am','ha','yo','ig'];

  if (esas_valyuta && !ICAZE_VERILEN_VALYUTALAR_L.includes(esas_valyuta.toUpperCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${esas_valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR_L.join(', ')} daxil edilə bilər.`);
  if (bildiris_metodu && !ICAZE_VERILEN_BILDIRISLER.includes(bildiris_metodu.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_NOTIFICATION_METHOD', `Yanlış bildiriş metodu: "${bildiris_metodu}". Yalnız ${ICAZE_VERILEN_BILDIRISLER.join(', ')} daxil edilə bilər.`);
  if (tema && !ICAZE_VERILEN_TEMALAR.includes(tema.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME', `Yanlış tema: "${tema}". Yalnız ${ICAZE_VERILEN_TEMALAR.join(', ')} daxil edilə bilər.`);
  if (dil && !ICAZE_VERILEN_DILLER.includes(dil.toLowerCase())) return errorResponse(res, 400, 'Bad Request', 'INVALID_LANGUAGE', `Yanlış dil kodu: "${dil}". ISO 639-1 formatında olmalıdır.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const settingsCheck = await executeQuery(`SELECT istifadeci_id FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`, { istifadeci_id: userId });
    let sql;
    if (settingsCheck.rows.length > 0) {
      sql = `UPDATE istifadeci_ayarlari SET esas_valyuta=:esas_valyuta, bildiris_metodu=:bildiris_metodu, dil=:dil, tema=:tema WHERE istifadeci_id=:istifadeci_id`;
    } else {
      sql = `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:istifadeci_id, :esas_valyuta, :bildiris_metodu, :dil, :tema)`;
    }
    await executeQuery(sql, {
      istifadeci_id: userId,
      esas_valyuta: esas_valyuta ? esas_valyuta.toUpperCase() : 'AZN',
      bildiris_metodu: bildiris_metodu ? bildiris_metodu.toLowerCase() : 'email',
      dil: dil ? dil.toLowerCase() : 'az',
      tema: tema ? tema.toLowerCase() : 'dark'
    }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Ayarlar uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});
startDueSubscriptionNotifierJob();
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Swagger documentation is available on http://localhost:${PORT}/api-docs`);
  //Remove ID GET endpoints and add notification validation;
  //Remove notification PUT endpoint
});
