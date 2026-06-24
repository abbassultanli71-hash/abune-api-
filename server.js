const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { executeQuery } = require('./db');
require('dotenv').config();

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
      version: '2.0.0',
      description: 'PostgreSQL verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı.',
    },
    servers: [
      { url: '/', description: 'Cari Server' },
      { url: `http://localhost:${PORT}`, description: 'Yerli API Serveri' },
    ],
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic' }
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

function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  return /^[a-zA-Z0-9_.]{3,50}$/.test(username.trim());
}

const ICAZE_VERILEN_VALYUTALAR = ['AZN', 'USD', 'EUR'];
const ICAZE_VERILEN_ODENIS_TEZLIKLERI = ['monthly', 'yearly', 'quarterly', 'weekly'];
const ICAZE_VERILEN_KATEQORIYALAR = ['Entertainment', 'Music', 'Education', 'Health & Fitness',
  'Productivity', 'Gaming', 'Cloud Storage', 'News', 'Food & Delivery', 'Shopping', 'Finance', 'Other'];
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
  const result = await executeQuery(
    `SELECT id FROM istifadeciler WHERE username = :username`,
    { username }
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].ID;
}

function hesablaNovbetiOdenisTarixi(baslamaTarixiStr, odenisTezliyi) {
  const [y, m, d] = baslamaTarixiStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  switch (odenisTezliyi) {
    case 'weekly':    next.setUTCDate(next.getUTCDate() + 7); break;
    case 'quarterly': next.setUTCMonth(next.getUTCMonth() + 3); break;
    case 'yearly':    next.setUTCFullYear(next.getUTCFullYear() + 1); break;
    case 'monthly':
    default:          next.setUTCMonth(next.getUTCMonth() + 1); break;
  }
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function successResponse(res, statusCode, message, data) {
  return res.status(statusCode).json({ code: statusCode, message, data });
}

function errorResponse(res, statusCode, message, errorCode, errorMessage) {
  return res.status(statusCode).json({
    code: statusCode, message, data: null,
    error: { code: errorCode, message: errorMessage }
  });
}

// Abunəlik yarananda avtomatik bildiriş əlavə edir
async function addAutoNotification(userId, appAd, novbetiOdenisTarixi, odenisTezliyi) {
  try {
    const [y, m, d] = novbetiOdenisTarixi.split('-').map(Number);
    const gonderilme = new Date(Date.UTC(y, m - 1, d));
    switch (odenisTezliyi) {
      case 'weekly':    gonderilme.setUTCDate(gonderilme.getUTCDate() - 2); break;
      case 'monthly':   gonderilme.setUTCDate(gonderilme.getUTCDate() - 7); break;
      case 'quarterly': gonderilme.setUTCDate(gonderilme.getUTCDate() - 7); break;
      case 'yearly':    gonderilme.setUTCDate(gonderilme.getUTCDate() - 14); break;
      default:          gonderilme.setUTCDate(gonderilme.getUTCDate() - 7); break;
    }
    const yyyy = gonderilme.getUTCFullYear();
    const mm = String(gonderilme.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(gonderilme.getUTCDate()).padStart(2, '0');
    const gonderilmeTarixiStr = `${yyyy}-${mm}-${dd}`;
    const basliq = `${appAd} abunəliyi aktivdir`;
    const mesaj = `${appAd} abunəliyiniz uğurla aktivləşdirildi. Növbəti ödəniş tarixi: ${novbetiOdenisTarixi}.`;
    await executeQuery(
      `INSERT INTO bildirisler (istifadeci_id, basliq, mesaj, gonderilme_tarixi)
       VALUES (:istifadeci_id, :basliq, :mesaj, :gonderilme_tarixi)`,
      { istifadeci_id: userId, basliq, mesaj, gonderilme_tarixi: gonderilmeTarixiStr },
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
    const result = await executeQuery(
      `SELECT id, username, ad, email,
              TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
       FROM istifadeciler WHERE username = :username`,
      { username }
    );
    if (result.rows.length === 0)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    return successResponse(res, 200, 'Success', { user: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler:
 *   post:
 *     summary: Yeni istifadəçi əlavə edir
 *     tags: [İstifadəçilər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, ad, email]
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

  if (!username || !ad || !email)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad və email sahələri məcburidir.');

  const trimmedUsername = String(username).trim();
  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (!isValidUsername(trimmedUsername))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər və 3-50 simvol aralığında olmalıdır.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır.');
  if (trimmedEmail.length > 100)
    return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');

  try {
    const usernameCheck = await executeQuery(
      `SELECT username FROM istifadeciler WHERE username = :username`, { username: trimmedUsername }
    );
    if (usernameCheck.rows.length > 0)
      return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_USERNAME', 'Bu username ilə artıq istifadəçi mövcuddur.');

    const emailCheck = await executeQuery(
      `SELECT email FROM istifadeciler WHERE email = :email`, { email: trimmedEmail }
    );
    if (emailCheck.rows.length > 0)
      return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    await executeQuery(
      `INSERT INTO istifadeciler (username, ad, email) VALUES (:username, :ad, :email)`,
      { username: trimmedUsername, ad: trimmedAd, email: trimmedEmail },
      { autoCommit: true }
    );

    const userResult = await executeQuery(
      `SELECT id FROM istifadeciler WHERE username = :username`, { username: trimmedUsername }
    );
    const userId = userResult.rows[0].ID;

    await executeQuery(
      `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
       VALUES (:userId, 'AZN', 'email', 'az', 'dark')`,
      { userId }, { autoCommit: true }
    );

    return successResponse(res, 201, 'Created', { message: 'İstifadəçi uğurla yaradıldı.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{username}:
 *   put:
 *     summary: İstifadəçi məlumatlarını yeniləyir
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
 *               username:
 *                 type: string
 *                 description: Yeni username (dəyişmək istəyirsinizsə)
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       404:
 *         description: Tapılmadı
 */
app.put('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  const { ad, email, username: yeniUsername } = req.body;

  if (!ad || !email)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Ad və email sahələri məcburidir.');

  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (trimmedAd.length < 3 || trimmedAd.length > 100)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır.');

  let trimmedYeniUsername = null;
  if (yeniUsername && String(yeniUsername).trim() !== '') {
    trimmedYeniUsername = String(yeniUsername).trim();
    if (!isValidUsername(trimmedYeniUsername))
      return errorResponse(res, 400, 'Bad Request', 'INVALID_USERNAME', 'Username yalnız hərf, rəqəm, "_" və "." ola bilər.');
  }

  try {
    const userCheck = await executeQuery(
      `SELECT id FROM istifadeciler WHERE username = :username`, { username }
    );
    if (userCheck.rows.length === 0)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    if (trimmedYeniUsername && trimmedYeniUsername !== username) {
      const dupCheck = await executeQuery(
        `SELECT username FROM istifadeciler WHERE username = :yeniUsername`, { yeniUsername: trimmedYeniUsername }
      );
      if (dupCheck.rows.length > 0)
        return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_USERNAME', 'Bu username ilə artıq istifadəçi mövcuddur.');
    }

    const emailCheck = await executeQuery(
      `SELECT email FROM istifadeciler WHERE email = :email AND username != :username`,
      { email: trimmedEmail, username }
    );
    if (emailCheck.rows.length > 0)
      return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    const finalUsername = trimmedYeniUsername || username;
    await executeQuery(
      `UPDATE istifadeciler SET username = :finalUsername, ad = :ad, email = :email WHERE username = :username`,
      { finalUsername, ad: trimmedAd, email: trimmedEmail, username },
      { autoCommit: true }
    );

    const updated = await executeQuery(
      `SELECT id, username, ad, email,
              TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
       FROM istifadeciler WHERE username = :finalUsername`,
      { finalUsername }
    );
    return successResponse(res, 200, 'Updated', { user: updated.rows[0] });
  } catch (err) {
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
    const result = await executeQuery(
      `DELETE FROM istifadeciler WHERE username = :username`, { username }, { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
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
 *     summary: İstifadəçinin abunəliklərini gətirir (username ilə)
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
 */
app.get('/api/abunelikler', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `SELECT a.id AS abunelik_id, u.username, a.ad, a.qiymet, a.valyuta, a.odenis_tezliyi,
              TO_CHAR(a.baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
              TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi,
              a.kateqoriya, a.status,
              TO_CHAR(a.yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
       FROM abunelikler a JOIN istifadeciler u ON a.istifadeci_id = u.id
       WHERE a.istifadeci_id = :istifadeci_id ORDER BY a.id`,
      { istifadeci_id: userId }
    );
    return successResponse(res, 200, 'Success', { subscriptions: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler:
 *   post:
 *     summary: Yeni abunəlik əlavə edir (avtomatik bildiriş və ödəniş tarixçəsi yaranır)
 *     tags: [Abunəliklər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, ad, qiymet, baslama_tarixi]
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
 *                 example: "2026-06-24"
 *               kateqoriya:
 *                 type: string
 *                 example: Entertainment
 *     responses:
 *       201:
 *         description: Abunəlik yaradıldı, bildiriş və ödəniş tarixçəsi avtomatik əlavə edildi
 */
app.post('/api/abunelikler', async (req, res) => {
  const { username, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya } = req.body;

  if (!username || !ad || qiymet === undefined || qiymet === null || !baslama_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad, qiymet, baslama_tarixi məcburidir.');

  const parsedQiymet = Number(qiymet);
  if (isNaN(parsedQiymet) || parsedQiymet <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_PRICE', 'Qiymət 0-dan böyük olmalıdır.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta. Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);

  const odenisTezliyi = odenis_tezliyi || 'monthly';
  if (!ICAZE_VERILEN_ODENIS_TEZLIKLERI.includes(odenisTezliyi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_FREQUENCY', `Yalnız ${ICAZE_VERILEN_ODENIS_TEZLIKLERI.join(', ')} daxil edilə bilər.`);

  if (!isValidDate(baslama_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Başlama tarixi düzgün deyil (Format: YYYY-MM-DD).`);

  if (kateqoriya && !ICAZE_VERILEN_KATEQORIYALAR.includes(kateqoriya))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CATEGORY', `Yalnış kateqoriya.`);

  const novbetiOdenisTarixi = hesablaNovbetiOdenisTarixi(baslama_tarixi, odenisTezliyi);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'İstifadəçi mövcud deyil.');

    // Abunəliyi əlavə et
    await executeQuery(
      `INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi,
        baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status)
       VALUES (:istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi,
        :baslama_tarixi, :novbeti_odenis_tarixi, :kateqoriya, 'active')`,
      {
        istifadeci_id: userId, ad, qiymet: parsedQiymet,
        valyuta: getValidCurrency(valyuta), odenis_tezliyi: odenisTezliyi,
        baslama_tarixi, novbeti_odenis_tarixi: novbetiOdenisTarixi,
        kateqoriya: kateqoriya || null
      },
      { autoCommit: true }
    );

    // Yeni yaranan abunəliyin ID-sini tap
    const newSub = await executeQuery(
      `SELECT id FROM abunelikler
       WHERE istifadeci_id = :istifadeci_id AND ad = :ad
       ORDER BY id DESC LIMIT 1`,
      { istifadeci_id: userId, ad }
    );
    const newSubId = newSub.rows.length > 0 ? newSub.rows[0].ID : null;

    // Avtomatik bildiriş əlavə et
    await addAutoNotification(userId, ad, novbetiOdenisTarixi, odenisTezliyi);

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
 *     summary: Abunəliyi username və abunəlik adına görə yeniləyir
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
 *         description: Mövcud abunəlik adı
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qiymet, baslama_tarixi]
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
 *               kateqoriya:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, deactive]
 *     responses:
 *       200:
 *         description: Yeniləndi
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
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta.`);

  const odenisTezliyi = odenis_tezliyi || 'monthly';
  if (!ICAZE_VERILEN_ODENIS_TEZLIKLERI.includes(odenisTezliyi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_FREQUENCY', `Yanlış ödəniş tezliyi.`);

  if (!isValidDate(baslama_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Tarix formatı yanlışdır (YYYY-MM-DD).`);

  if (kateqoriya && !ICAZE_VERILEN_KATEQORIYALAR.includes(kateqoriya))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CATEGORY', `Yanlış kateqoriya.`);

  const statusValue = status || 'active';
  if (!ICAZE_VERILEN_STATUSLAR.includes(statusValue))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_STATUS', `Yalnız active və ya deactive ola bilər.`);

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
       baslama_tarixi=:baslama_tarixi, novbeti_odenis_tarixi=:novbeti_odenis_tarixi,
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
 * /api/abunelikler:
 *   delete:
 *     summary: Abunəliyi username və abunəlik adına görə silir
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
 *     responses:
 *       200:
 *         description: Silindi
 *       404:
 *         description: Tapılmadı
 */
app.delete('/api/abunelikler', async (req, res) => {
  const { username, ad } = req.query;
  if (!username || !ad)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username və ad query parametrləri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `DELETE FROM abunelikler WHERE istifadeci_id = :istifadeci_id AND ad = :ad`,
      { istifadeci_id: userId, ad },
      { autoCommit: true }
    );
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Abunəlik uğurla silindi.' });
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
 *     summary: İstifadəçinin bildirişlərini gətirir (username ilə)
 *     tags: [Bildirişlər]
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
app.get('/api/bildirisler', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    // Cədvəldəki köhnə bildirişlər
    const dbBildirisler = await executeQuery(
      `SELECT b.id AS bildiris_id, u.username, b.basliq, b.mesaj,
              TO_CHAR(b.gonderilme_tarixi, 'YYYY-MM-DD HH24:MI:SS') as gonderilme_tarixi
       FROM bildirisler b JOIN istifadeciler u ON b.istifadeci_id = u.id
       WHERE b.istifadeci_id = :istifadeci_id ORDER BY b.id DESC`,
      { istifadeci_id: userId }
    );

    // Aktiv abunəliklərə əsasən avtomatik bildirişlər
   const result = await executeQuery(
      `SELECT b.id AS bildiris_id, u.username, b.basliq, b.mesaj,
              TO_CHAR(b.gonderilme_tarixi, 'YYYY-MM-DD HH24:MI:SS') as gonderilme_tarixi
       FROM bildirisler b JOIN istifadeciler u ON b.istifadeci_id = u.id
       WHERE b.istifadeci_id = :istifadeci_id ORDER BY b.id DESC`,
      { istifadeci_id: userId }
    );
    return successResponse(res, 200, 'Success', { notifications: result.rows });
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
 *     summary: İstifadəçinin ödəniş tarixçəsini gətirir (username ilə)
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
 */
app.get('/api/odenis-tarixcesi', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `SELECT o.id AS odenis_tarixcesi_id, o.abunelik_id, u.username, a.ad as abunelik_ad,
              TO_CHAR(o.odenis_tarixi, 'YYYY-MM-DD') as odenis_tarixi,
              o.mebleq, o.status
       FROM odenis_tarixcesi o
       JOIN istifadeciler u ON o.istifadeci_id = u.id
       JOIN abunelikler a ON o.abunelik_id = a.id
       WHERE o.istifadeci_id = :istifadeci_id ORDER BY o.odenis_tarixi DESC`,
      { istifadeci_id: userId }
    );
    return successResponse(res, 200, 'Success', { paymentHistory: result.rows });
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
 *     summary: İstifadəçinin ödəniş metodlarını gətirir (username ilə)
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
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `SELECT c.id AS card_id, u.username, c.ad, c.kart_tipi, c.son_dord_reqem,
              c.kart_istifade_tarixi, c.status
       FROM odenis_metodlari c JOIN istifadeciler u ON c.istifadeci_id = u.id
       WHERE c.istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );
    return successResponse(res, 200, 'Success', { cards: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari:
 *   post:
 *     summary: Yeni ödəniş metodu əlavə edir
 *     tags: [Ödəniş Metodları]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, ad, kart_tipi]
 *             properties:
 *               username:
 *                 type: string
 *               ad:
 *                 type: string
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *               son_dord_reqem:
 *                 type: string
 *               kart_istifade_tarixi:
 *                 type: string
 *     responses:
 *       201:
 *         description: Əlavə edildi
 */
app.post('/api/odenis-metodlari', async (req, res) => {
  const { username, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi } = req.body;
  if (!username || !ad || !kart_tipi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username, ad və kart_tipi məcburidir.');

  const ICAZE_VERILEN_KARTLAR = ['visa', 'mastercard', 'maestro', 'unionpay', 'american express', 'amex', 'birkart', 'tamkart', 'bolkart', 'ucard'];
  const KART_FORMATLARI = { 'visa': 'Visa', 'mastercard': 'Mastercard', 'maestro': 'Maestro', 'unionpay': 'UnionPay', 'american express': 'American Express', 'amex': 'American Express', 'birkart': 'Birkart', 'tamkart': 'Tamkart', 'bolkart': 'Bolkart', 'ucard': 'Ucard' };
  const normalizedKartTipi = kart_tipi.trim().toLowerCase();

  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_TYPE', `Yanlış kart növü. Yalnız Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard icazəlidir.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    await executeQuery(
      `INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi)
       VALUES (:istifadeci_id, :ad, :kart_tipi, :son_dord_reqem, :kart_istifade_tarixi)`,
      {
        istifadeci_id: userId, ad,
        kart_tipi: KART_FORMATLARI[normalizedKartTipi],
        son_dord_reqem: son_dord_reqem || null,
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
 * /api/odenis-metodlari:
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
    if (result.rowsAffected === 0)
      return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
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
 *     summary: İstifadəçinin büdcəsini gətirir (username ilə)
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
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `SELECT b.id, u.username, b.limit_mebleq, b.valyuta, b.hesab_mebleqi
       FROM budceler b JOIN istifadeciler u ON b.istifadeci_id = u.id
       WHERE b.istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );
    return successResponse(res, 200, 'Success', { budgets: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/budceler:
 *   post:
 *     summary: Yeni büdcə limiti əlavə edir
 *     tags: [Büdcələr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, limit_mebleq]
 *             properties:
 *               username:
 *                 type: string
 *               limit_mebleq:
 *                 type: number
 *               valyuta:
 *                 type: string
 *               hesab_mebleqi:
 *                 type: number
 *     responses:
 *       201:
 *         description: Yaradıldı
 */
app.post('/api/budceler', async (req, res) => {
  const { username, limit_mebleq, valyuta, hesab_mebleqi } = req.body;
  if (!username || limit_mebleq === undefined || limit_mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'username və limit_mebleq məcburidir.');

  const parsedLimit = Number(limit_mebleq);
  if (isNaN(parsedLimit) || parsedLimit <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'limit_mebleq 0-dan böyük olmalıdır.');

  const parsedHesab = (hesab_mebleqi !== undefined && hesab_mebleqi !== null) ? Number(hesab_mebleqi) : 0;
  if (isNaN(parsedHesab) || parsedHesab < 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_AMOUNT', 'hesab_mebleqi mənfi ola bilməz.');

  if (parsedHesab > parsedLimit)
    return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED', 'Hesabdakı məbləğ limit məbləğdən çox ola bilməz.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    await executeQuery(
      `INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, hesab_mebleqi)
       VALUES (:istifadeci_id, :limit_mebleq, :valyuta, :hesab_mebleqi)`,
      { istifadeci_id: userId, limit_mebleq: parsedLimit, valyuta: getValidCurrency(valyuta), hesab_mebleqi: parsedHesab },
      { autoCommit: true }
    );
    return successResponse(res, 201, 'Created', { message: 'Büdcə limiti uğurla quraşdırıldı.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/budceler:
 *   put:
 *     summary: Büdcə limitini username-ə görə yeniləyir
 *     tags: [Büdcələr]
 *     parameters:
 *       - in: query
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
 *               hesab_mebleqi:
 *                 type: number
 *     responses:
 *       200:
 *         description: Yeniləndi
 */
app.put('/api/budceler', async (req, res) => {
  const { username } = req.query;
  if (!username)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'username parametri məcburidir.');

  const { limit_mebleq, valyuta, hesab_mebleqi } = req.body;
  if (limit_mebleq === undefined)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'limit_mebleq məcburidir.');

  const parsedLimit = Number(limit_mebleq);
  if (isNaN(parsedLimit) || parsedLimit <= 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LIMIT', 'limit_mebleq 0-dan böyük olmalıdır.');

  const parsedHesab = (hesab_mebleqi !== undefined && hesab_mebleqi !== null) ? Number(hesab_mebleqi) : 0;
  if (isNaN(parsedHesab) || parsedHesab < 0)
    return errorResponse(res, 400, 'Bad Request', 'INVALID_AMOUNT', 'hesab_mebleqi mənfi ola bilməz.');

  if (parsedHesab > parsedLimit)
    return errorResponse(res, 400, 'Bad Request', 'BUDGET_EXCEEDED', 'Hesabdakı məbləğ limit məbləğdən çox ola bilməz.');

  if (valyuta && !isValidCurrency(valyuta))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta.`);

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
      return errorResponse(res, 404, 'Not Found', 'BUDGET_NOT_FOUND', 'Büdcə tapılmadı.');
    return successResponse(res, 200, 'Updated', { message: 'Büdcə limiti uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

// =============================================
// --- AYARLAR (Settings) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/ayarlar/{username}:
 *   get:
 *     summary: İstifadəçinin ayarlarını gətirir
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
 */
app.get('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const result = await executeQuery(
      `SELECT istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema
       FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );

    if (result.rows.length === 0) {
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
         VALUES (:istifadeci_id, 'AZN', 'email', 'az', 'dark')`,
        { istifadeci_id: userId }, { autoCommit: true }
      );
      return successResponse(res, 200, 'Success', {
        settings: { istifadeci_id: userId, username, esas_valyuta: 'AZN', bildiris_metodu: 'email', dil: 'az', tema: 'dark' }
      });
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
 *     summary: İstifadəçinin ayarlarını yeniləyir
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
 *               bildiris_metodu:
 *                 type: string
 *                 enum: [email, telegram]
 *               dil:
 *                 type: string
 *               tema:
 *                 type: string
 *                 enum: [light, dark]
 *     responses:
 *       200:
 *         description: Yeniləndi
 */
app.put('/api/ayarlar/:username', async (req, res) => {
  const { username } = req.params;
  const { esas_valyuta, bildiris_metodu, dil, tema } = req.body;

  const ICAZE_VERILEN_VALYUTALAR_L = ['AZN', 'USD', 'EUR'];
  const ICAZE_VERILEN_BILDIRISLER = ['email', 'telegram'];
  const ICAZE_VERILEN_TEMALAR = ['light', 'dark'];
  const ICAZE_VERILEN_DILLER = ['az', 'en', 'ru', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'zh', 'ja', 'ko', 'hi', 'nl', 'pl', 'sv', 'no', 'da', 'fi'];

  if (esas_valyuta && !ICAZE_VERILEN_VALYUTALAR_L.includes(esas_valyuta.toUpperCase()))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta.`);
  if (bildiris_metodu && !ICAZE_VERILEN_BILDIRISLER.includes(bildiris_metodu.toLowerCase()))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_NOTIFICATION_METHOD', `Yalnız email və ya telegram ola bilər.`);
  if (tema && !ICAZE_VERILEN_TEMALAR.includes(tema.toLowerCase()))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_THEME', `Yalnız light və ya dark ola bilər.`);
  if (dil && !ICAZE_VERILEN_DILLER.includes(dil.toLowerCase()))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_LANGUAGE', `Yanlış dil kodu.`);

  try {
    const userId = await getUserIdByUsername(username);
    if (userId === null)
      return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const settingsCheck = await executeQuery(
      `SELECT istifadeci_id FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`,
      { istifadeci_id: userId }
    );

    const params = {
      istifadeci_id: userId,
      esas_valyuta: esas_valyuta ? esas_valyuta.toUpperCase() : 'AZN',
      bildiris_metodu: bildiris_metodu ? bildiris_metodu.toLowerCase() : 'email',
      dil: dil ? dil.toLowerCase() : 'az',
      tema: tema ? tema.toLowerCase() : 'dark'
    };

    if (settingsCheck.rows.length > 0) {
      await executeQuery(
        `UPDATE istifadeci_ayarlari SET esas_valyuta=:esas_valyuta, bildiris_metodu=:bildiris_metodu,
         dil=:dil, tema=:tema WHERE istifadeci_id=:istifadeci_id`,
        params, { autoCommit: true }
      );
    } else {
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
         VALUES (:istifadeci_id, :esas_valyuta, :bildiris_metodu, :dil, :tema)`,
        params, { autoCommit: true }
      );
    }
    return successResponse(res, 200, 'Updated', { message: 'Ayarlar uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
});
