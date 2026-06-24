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
      version: '1.0.0',
      description: 'Oracle verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı.',
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
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isValidTimestamp(tsStr) {
  if (typeof tsStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!regex.test(tsStr)) return false;
  const [datePart, timePart] = tsStr.split(' ');
  if (!isValidDate(datePart)) return false;
  const [hour, min, sec] = timePart.split(':').map(Number);
  return hour >= 0 && hour < 24 && min >= 0 && min < 60 && sec >= 0 && sec < 60;
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const ICAZE_VERILEN_VALYUTALAR = ['AZN', 'USD', 'EUR'];
const ICAZE_VERILEN_ODENIS_TEZLIKLERI = ['monthly', 'yearly', 'quarterly', 'weekly'];

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
}

function isValidCurrency(valyuta) {
  return ICAZE_VERILEN_VALYUTALAR.includes(getValidCurrency(valyuta));
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

// =============================================
// --- ISTIFADECILER (Users) ROUTES ---
// =============================================

/**
 * @swagger
 * /api/istifadeciler:
 *   get:
 *     summary: Bütün istifadəçiləri siyahılayır
 *     tags: [İstifadəçilər]
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
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 */
app.get('/api/istifadeciler', async (req, res) => {
  try {
    const sql = `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler ORDER BY id`;
    const result = await executeQuery(sql);
    return successResponse(res, 200, 'Success', { users: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{id}:
 *   get:
 *     summary: ID-yə görə istifadəçini gətirir
 *     tags: [İstifadəçilər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *                     user:
 *                       type: object
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/istifadeciler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE id = :id`;
    const result = await executeQuery(sql, { id });
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
 *     summary: Yeni istifadəçi əlavə edir
 *     tags: [İstifadəçilər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ad
 *               - email
 *             properties:
 *               id:
 *                 type: integer
 *                 example: 3
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
  const { id, ad, email } = req.body;

  if (!ad || !email) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Ad və email sahələri məcburidir.');

  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (trimmedAd.length === 0 || trimmedEmail.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'Ad və email sahələri boş qoyula bilməz.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');

  if (id !== undefined && id !== null) {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) return errorResponse(res, 400, 'Bad Request', 'INVALID_ID', 'ID yalnız müsbət tam ədəd olmalıdır.');
  }

  try {
    if (id) {
      const idCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :id`, { id });
      if (idCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ID', 'Bu ID ilə artıq istifadəçi mövcuddur.');
    }
    const emailCheck = await executeQuery(`SELECT email FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    if (emailCheck.rows.length > 0) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_EMAIL', 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.');

    let sql, binds;
    if (id) {
      sql = `INSERT INTO istifadeciler (id, ad, email) VALUES (:id, :ad, :email)`;
      binds = { id, ad: trimmedAd, email: trimmedEmail };
    } else {
      sql = `INSERT INTO istifadeciler (ad, email) VALUES (:ad, :email)`;
      binds = { ad: trimmedAd, email: trimmedEmail };
    }
    await executeQuery(sql, binds, { autoCommit: true });

    const userResult = await executeQuery(`SELECT id FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    const userId = userResult.rows[0].ID;
    await executeQuery(
      `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:userId, 'AZN', 'email', 'az', 'dark')`,
      { userId }, { autoCommit: true }
    );
    return successResponse(res, 201, 'Created', { message: 'İstifadəçi və onun ilkin ayarları uğurla yaradıldı.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Məlumatların unikallığı pozuldu (eyni ID və ya email artıq mövcuddur).');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{id}:
 *   put:
 *     summary: İstifadəçi məlumatlarını yeniləyir
 *     tags: [İstifadəçilər]
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
 *               - email
 *             properties:
 *               ad:
 *                 type: string
 *                 example: Abbas Abbasov
 *               email:
 *                 type: string
 *                 example: abbas@example.com
 *               yaradilma_tarixi:
 *                 type: string
 *                 example: "2026-06-19 12:00:00"
 *     responses:
 *       200:
 *         description: İstifadəçi yeniləndi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.put('/api/istifadeciler/:id', async (req, res) => {
  const { id } = req.params;
  const { ad, email, yaradilma_tarixi } = req.body;

  if (!ad || !email) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Ad və email sahələri məcburidir.');
  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();
  if (trimmedAd.length === 0 || trimmedEmail.length === 0) return errorResponse(res, 400, 'Bad Request', 'EMPTY_FIELDS', 'Ad və email sahələri boş qoyula bilməz.');
  if (trimmedAd.length < 3 || trimmedAd.length > 100) return errorResponse(res, 400, 'Bad Request', 'INVALID_NAME_LENGTH', 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (!isValidEmail(trimmedEmail)) return errorResponse(res, 400, 'Bad Request', 'INVALID_EMAIL', 'Email ünvanının formatı yanlışdır.');
  if (trimmedEmail.length > 100) return errorResponse(res, 400, 'Bad Request', 'EMAIL_TOO_LONG', 'Email ən çoxu 100 simvoldan ibarət olmalıdır.');
  if (yaradilma_tarixi && !isValidTimestamp(yaradilma_tarixi)) return errorResponse(res, 400, 'Bad Request', 'INVALID_TIMESTAMP', `Yaradılma tarixi düzgün deyil: "${yaradilma_tarixi}" (Format: YYYY-MM-DD HH24:MI:SS).`);
  if (req.body.id !== undefined && Number(req.body.id) !== Number(id)) return errorResponse(res, 400, 'Bad Request', 'ID_IMMUTABLE', 'İstifadəçinin ID-si dəyişdirilə bilməz.');

  try {
    let sql, binds;
    if (yaradilma_tarixi) {
      sql = `UPDATE istifadeciler SET ad = :ad, email = :email, yaradilma_tarixi = TO_TIMESTAMP(:yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') WHERE id = :id`;
      binds = { ad: trimmedAd, email: trimmedEmail, yaradilma_tarixi, id };
    } else {
      sql = `UPDATE istifadeciler SET ad = :ad, email = :email WHERE id = :id`;
      binds = { ad: trimmedAd, email: trimmedEmail, id };
    }
    const result = await executeQuery(sql, binds, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const updated = await executeQuery(
      `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE id = :id`, { id }
    );
    return successResponse(res, 200, 'Updated', { user: updated.rows[0] });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ENTRY', 'Bu email və ya ID artıq mövcuddur.');
    if (err.message && err.message.includes('ORA-02292')) return errorResponse(res, 400, 'Bad Request', 'FK_CONSTRAINT', 'İstifadəçinin abunəliyi və ya bildirişi olduğu üçün ID dəyişdirilə bilməz.');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/istifadeciler/{id}:
 *   delete:
 *     summary: İstifadəçini silir
 *     tags: [İstifadəçilər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: İstifadəçi silindi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.delete('/api/istifadeciler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(`DELETE FROM istifadeciler WHERE id = :id`, { id }, { autoCommit: true });
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
 *     summary: İstifadəçinin abunəliklərini siyahılayır
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       400:
 *         description: istifadeci_id göndərilmədi
 */
app.get('/api/abunelikler', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'istifadeci_id sorğu parametri məcburidir.');
  try {
    const sql = `
      SELECT id AS abunelik_id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi,
             TO_CHAR(baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
             TO_CHAR(novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi,
             kateqoriya, status,
             TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
      FROM abunelikler WHERE istifadeci_id = :istifadeci_id ORDER BY id
    `;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) return successResponse(res, 200, 'No subscriptions found', { subscriptions: [] });
    return successResponse(res, 200, 'Success', { subscriptions: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler/{id}:
 *   get:
 *     summary: ID-yə görə abunəliyi gətirir
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       404:
 *         description: Abunəlik tapılmadı
 */
app.get('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT id AS abunelik_id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi,
             TO_CHAR(baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
             TO_CHAR(novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi,
             kateqoriya, status,
             TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
      FROM abunelikler WHERE id = :id
    `;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');
    return successResponse(res, 200, 'Success', { subscription: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler:
 *   post:
 *     summary: Yeni abunəlik əlavə edir
 *     tags: [Abunəliklər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - istifadeci_id
 *               - ad
 *               - qiymet
 *               - baslama_tarixi
 *               - novbeti_odenis_tarixi
 *             properties:
 *               abunelik_id:
 *                 type: integer
 *                 example: 3
 *               istifadeci_id:
 *                 type: integer
 *                 example: 1
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
 *                 example: "2026-01-01"
 *               novbeti_odenis_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-01"
 *               kateqoriya:
 *                 type: string
 *                 example: Entertainment
 *               status:
 *                 type: string
 *                 example: active
 *               yaradilma_tarixi:
 *                 type: string
 *                 example: "2026-06-19 10:00:00"
 *     responses:
 *       201:
 *         description: Abunəlik əlavə edildi
 */
app.post('/api/abunelikler', async (req, res) => {
  const { abunelik_id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status, yaradilma_tarixi } = req.body;

  if (!istifadeci_id || !ad || qiymet === undefined || qiymet === null || !baslama_tarixi || !novbeti_odenis_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (istifadeci_id, ad, qiymet, baslama_tarixi, novbeti_odenis_tarixi) doldurun.');

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

  if (!isValidDate(novbeti_odenis_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Növbəti ödəniş tarixi düzgün deyil: "${novbeti_odenis_tarixi}" (Format: YYYY-MM-DD).`);

  if (yaradilma_tarixi && !isValidTimestamp(yaradilma_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_TIMESTAMP', `Yaradılma tarixi düzgün deyil: "${yaradilma_tarixi}" (Format: YYYY-MM-DD HH24:MI:SS).`);

  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.');

    const yaradilmaCol = yaradilma_tarixi ? ', yaradilma_tarixi' : '';
    const yaradilmaVal = yaradilma_tarixi ? `, TO_TIMESTAMP(:yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS')` : '';

    let sql, binds;
    if (abunelik_id) {
      sql = `INSERT INTO abunelikler (id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status${yaradilmaCol})
             VALUES (:abunelik_id, :istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'), :kateqoriya, :status${yaradilmaVal})`;
      binds = { abunelik_id, istifadeci_id, ad, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta), odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya: kateqoriya || null, status: status || 'active', ...(yaradilma_tarixi && { yaradilma_tarixi }) };
    } else {
      sql = `INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status${yaradilmaCol})
             VALUES (:istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'), :kateqoriya, :status${yaradilmaVal})`;
      binds = { istifadeci_id, ad, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta), odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya: kateqoriya || null, status: status || 'active', ...(yaradilma_tarixi && { yaradilma_tarixi }) };
    }

    await executeQuery(sql, binds, { autoCommit: true });
    return successResponse(res, 201, 'Created', { message: 'Abunəlik uğurla əlavə edildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ID', 'Bu abunəlik ID-si artıq mövcuddur.');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler/{id}:
 *   put:
 *     summary: Abunəlik məlumatlarını yeniləyir
 *     tags: [Abunəliklər]
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
 *               - qiymet
 *               - baslama_tarixi
 *               - novbeti_odenis_tarixi
 *             properties:
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
 *                 example: "2026-01-01"
 *               novbeti_odenis_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-01"
 *               kateqoriya:
 *                 type: string
 *                 example: Entertainment
 *               status:
 *                 type: string
 *                 example: active
 *     responses:
 *       200:
 *         description: Abunəlik yeniləndi
 *       404:
 *         description: Abunəlik tapılmadı
 */
app.put('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  const { abunelik_id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status } = req.body;

  if (!ad || qiymet === undefined || qiymet === null || !baslama_tarixi || !novbeti_odenis_tarixi)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (ad, qiymet, baslama_tarixi, novbeti_odenis_tarixi) doldurun.');

  if (abunelik_id && Number(abunelik_id) !== Number(id))
    return errorResponse(res, 400, 'Bad Request', 'ID_IMMUTABLE', 'Abunəliyin ID-si dəyişdirilə bilməz.');

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

  if (!isValidDate(novbeti_odenis_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Növbəti ödəniş tarixi düzgün deyil: "${novbeti_odenis_tarixi}" (Format: YYYY-MM-DD).`);

  try {
    const subCheck = await executeQuery(`SELECT id, istifadeci_id FROM abunelikler WHERE id = :id`, { id });
    if (subCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');

    if (istifadeci_id !== undefined && Number(istifadeci_id) !== Number(subCheck.rows[0].ISTIFADECI_ID))
      return errorResponse(res, 400, 'Bad Request', 'USER_IMMUTABLE', 'Abunəliyin aid olduğu istifadəçi (istifadeci_id) dəyişdirilə bilməz.');

    const sql = `UPDATE abunelikler SET ad=:ad, qiymet=:qiymet, valyuta=:valyuta, odenis_tezliyi=:odenis_tezliyi,
                 baslama_tarixi=TO_DATE(:baslama_tarixi,'YYYY-MM-DD'), novbeti_odenis_tarixi=TO_DATE(:novbeti_odenis_tarixi,'YYYY-MM-DD'),
                 kateqoriya=:kateqoriya, status=:status WHERE id=:id`;
    await executeQuery(sql, { ad, qiymet: parsedQiymet, valyuta: getValidCurrency(valyuta), odenis_tezliyi: odenisTezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya: kateqoriya || null, status: status || 'active', id }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Abunəlik uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/abunelikler/{id}:
 *   delete:
 *     summary: Abunəliyi silir
 *     tags: [Abunəliklər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Abunəlik silindi
 *       404:
 *         description: Abunəlik tapılmadı
 */
app.delete('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(`DELETE FROM abunelikler WHERE id = :id`, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'SUBSCRIPTION_NOT_FOUND', 'Abunəlik tapılmadı.');
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
 *     summary: İstifadəçinin bildirişlərini siyahılayır
 *     tags: [Bildirişlər]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       400:
 *         description: istifadeci_id göndərilmədi
 */
app.get('/api/bildirisler', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'istifadeci_id sorğu parametri məcburidir.');
  try {
    const sql = `SELECT id AS bildiris_id, istifadeci_id, basliq, mesaj, TO_CHAR(gonderilme_tarixi, 'YYYY-MM-DD') as gonderilme_tarixi FROM bildirisler WHERE istifadeci_id = :istifadeci_id ORDER BY id DESC`;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) return successResponse(res, 200, 'No notifications found', { notifications: [] });
    return successResponse(res, 200, 'Success', { notifications: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/bildirisler/{id}:
 *   get:
 *     summary: ID-yə görə bildirişi gətirir
 *     tags: [Bildirişlər]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.get('/api/bildirisler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id AS bildiris_id, istifadeci_id, basliq, mesaj, TO_CHAR(gonderilme_tarixi, 'YYYY-MM-DD') as gonderilme_tarixi FROM bildirisler WHERE id = :id`;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    return successResponse(res, 200, 'Success', { notification: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/bildirisler:
 *   post:
 *     summary: Yeni bildiriş göndərir
 *     tags: [Bildirişlər]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - istifadeci_id
 *               - basliq
 *               - mesaj
 *             properties:
 *               bildiris_id:
 *                 type: integer
 *                 example: 5
 *               istifadeci_id:
 *                 type: integer
 *                 example: 1
 *               basliq:
 *                 type: string
 *                 example: Yaxınlaşan Ödəniş
 *               mesaj:
 *                 type: string
 *                 example: Netflix abunəliyiniz növbəti ay üçün yenilənəcək.
 *     responses:
 *       201:
 *         description: Bildiriş göndərildi
 */
app.post('/api/bildirisler', async (req, res) => {
  const { bildiris_id, istifadeci_id, basliq, mesaj } = req.body;
  if (!istifadeci_id || !basliq || !mesaj) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (istifadeci_id, basliq, mesaj) doldurun.');
  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.');

    let sql, binds;
    if (bildiris_id) {
      sql = `INSERT INTO bildirisler (id, istifadeci_id, basliq, mesaj) VALUES (:bildiris_id, :istifadeci_id, :basliq, :mesaj)`;
      binds = { bildiris_id, istifadeci_id, basliq, mesaj };
    } else {
      sql = `INSERT INTO bildirisler (istifadeci_id, basliq, mesaj) VALUES (:istifadeci_id, :basliq, :mesaj)`;
      binds = { istifadeci_id, basliq, mesaj };
    }
    await executeQuery(sql, binds, { autoCommit: true });
    return successResponse(res, 201, 'Created', { message: 'Bildiriş uğurla göndərildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ID', 'Bu bildiriş ID-si artıq mövcuddur.');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/bildirisler/{id}:
 *   put:
 *     summary: Bildiriş məlumatlarını yeniləyir
 *     tags: [Bildirişlər]
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
 *               - basliq
 *               - mesaj
 *             properties:
 *               basliq:
 *                 type: string
 *                 example: Yaxınlaşan Ödəniş
 *               mesaj:
 *                 type: string
 *                 example: Netflix abunəliyiniz növbəti ay üçün yenilənəcək.
 *     responses:
 *       200:
 *         description: Bildiriş yeniləndi
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.put('/api/bildirisler/:id', async (req, res) => {
  const { id } = req.params;
  const { basliq, mesaj } = req.body;
  if (!basliq || !mesaj) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (basliq, mesaj) doldurun.');
  if (req.body.bildiris_id !== undefined && Number(req.body.bildiris_id) !== Number(id)) return errorResponse(res, 400, 'Bad Request', 'ID_IMMUTABLE', 'Bildirişin ID-si dəyişdirilə bilməz.');
  try {
    const checkResult = await executeQuery(`SELECT id, istifadeci_id FROM bildirisler WHERE id = :id`, { id });
    if (checkResult.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
    if (req.body.istifadeci_id !== undefined && Number(req.body.istifadeci_id) !== Number(checkResult.rows[0].ISTIFADECI_ID))
      return errorResponse(res, 400, 'Bad Request', 'USER_IMMUTABLE', 'Bildirişin aid olduğu istifadəçi dəyişdirilə bilməz.');
    await executeQuery(`UPDATE bildirisler SET basliq=:basliq, mesaj=:mesaj WHERE id=:id`, { basliq, mesaj, id }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Bildiriş uğurla yeniləndi.' });
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
    const result = await executeQuery(`DELETE FROM bildirisler WHERE id = :id`, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'NOTIFICATION_NOT_FOUND', 'Bildiriş tapılmadı.');
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
 *     summary: İstifadəçinin ödəniş tarixçəsini siyahılayır
 *     tags: [Ödəniş Tarixçəsi]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       400:
 *         description: istifadeci_id göndərilmədi
 */
app.get('/api/odenis-tarixcesi', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'istifadeci_id sorğu parametri məcburidir.');
  try {
    const sql = `SELECT id AS odenis_tarixcesi_id, abunelik_id, istifadeci_id, TO_CHAR(odenis_tarixi, 'YYYY-MM-DD') as odenis_tarixi, mebleq, status FROM odenis_tarixcesi WHERE istifadeci_id = :istifadeci_id ORDER BY odenis_tarixi DESC`;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) return successResponse(res, 200, 'No payment history found', { paymentHistory: [] });
    return successResponse(res, 200, 'Success', { paymentHistory: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-tarixcesi/{id}:
 *   get:
 *     summary: ID-yə görə ödəniş tarixçəsini gətirir
 *     tags: [Ödəniş Tarixçəsi]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       404:
 *         description: Tapılmadı
 */
app.get('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id AS odenis_tarixcesi_id, abunelik_id, istifadeci_id, TO_CHAR(odenis_tarixi, 'YYYY-MM-DD') as odenis_tarixi, mebleq, status FROM odenis_tarixcesi WHERE id = :id`;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'PAYMENT_NOT_FOUND', 'Ödəniş tarixçəsi tapılmadı.');
    return successResponse(res, 200, 'Success', { paymentHistory: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-tarixcesi:
 *   post:
 *     summary: Yeni ödəniş tarixçəsi qeydi əlavə edir
 *     tags: [Ödəniş Tarixçəsi]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - abunelik_id
 *               - istifadeci_id
 *               - odenis_tarixi
 *               - mebleq
 *             properties:
 *               odenis_tarixcesi_id:
 *                 type: integer
 *                 example: 5
 *               abunelik_id:
 *                 type: integer
 *                 example: 1
 *               istifadeci_id:
 *                 type: integer
 *                 example: 1
 *               odenis_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-19"
 *               mebleq:
 *                 type: number
 *                 example: 12.99
 *               status:
 *                 type: string
 *                 enum: [success, fail]
 *                 example: success
 *     responses:
 *       201:
 *         description: Əlavə edildi
 */
app.post('/api/odenis-tarixcesi', async (req, res) => {
  const { odenis_tarixcesi_id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status } = req.body;
  if (!abunelik_id || !istifadeci_id || !odenis_tarixi || mebleq === undefined || mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (abunelik_id, istifadeci_id, odenis_tarixi, mebleq) doldurun.');
  if (!isValidDate(odenis_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Ödəniş tarixi düzgün deyil: "${odenis_tarixi}" (Format: YYYY-MM-DD).`);
  const statusValue = status || 'success';
  if (statusValue !== 'success' && statusValue !== 'fail')
    return errorResponse(res, 400, 'Bad Request', 'INVALID_STATUS', 'Status yalnız "success" və ya "fail" ola bilər.');
  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.');
    const subCheck = await executeQuery(`SELECT id, istifadeci_id FROM abunelikler WHERE id = :abunelik_id`, { abunelik_id });
    if (subCheck.rows.length === 0) return errorResponse(res, 400, 'Bad Request', 'SUBSCRIPTION_NOT_FOUND', 'Qeyd olunan abunəlik (abunelik_id) mövcud deyil.');
    if (Number(subCheck.rows[0].ISTIFADECI_ID) !== Number(istifadeci_id)) return errorResponse(res, 400, 'Bad Request', 'SUBSCRIPTION_USER_MISMATCH', 'Qeyd olunan abunəlik daxil etdiyiniz istifadəçiyə məxsus deyil.');

    let sql, binds;
    if (odenis_tarixcesi_id) {
      sql = `INSERT INTO odenis_tarixcesi (id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status) VALUES (:odenis_tarixcesi_id, :abunelik_id, :istifadeci_id, TO_DATE(:odenis_tarixi,'YYYY-MM-DD'), :mebleq, :status)`;
      binds = { odenis_tarixcesi_id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status: statusValue };
    } else {
      sql = `INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status) VALUES (:abunelik_id, :istifadeci_id, TO_DATE(:odenis_tarixi,'YYYY-MM-DD'), :mebleq, :status)`;
      binds = { abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status: statusValue };
    }
    await executeQuery(sql, binds, { autoCommit: true });
    return successResponse(res, 201, 'Created', { message: 'Ödəniş tarixçəsi qeydi uğurla əlavə edildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) return errorResponse(res, 400, 'Bad Request', 'DUPLICATE_ID', 'Bu ödəniş tarixçəsi ID-si artıq mövcuddur.');
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-tarixcesi/{id}:
 *   put:
 *     summary: Ödəniş tarixçəsi qeydini yeniləyir
 *     tags: [Ödəniş Tarixçəsi]
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
 *               - odenis_tarixi
 *               - mebleq
 *             properties:
 *               odenis_tarixi:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-19"
 *               mebleq:
 *                 type: number
 *                 example: 12.99
 *               status:
 *                 type: string
 *                 enum: [success, fail]
 *                 example: success
 *     responses:
 *       200:
 *         description: Yeniləndi
 *       404:
 *         description: Tapılmadı
 */
app.put('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  const { odenis_tarixi, mebleq, status } = req.body;
  if (!odenis_tarixi || mebleq === undefined || mebleq === null)
    return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələri (odenis_tarixi, mebleq) doldurun.');
  if (!isValidDate(odenis_tarixi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_DATE', `Ödəniş tarixi düzgün deyil: "${odenis_tarixi}" (Format: YYYY-MM-DD).`);
  const statusValue = status || 'success';
  if (statusValue !== 'success' && statusValue !== 'fail')
    return errorResponse(res, 400, 'Bad Request', 'INVALID_STATUS', 'Status yalnız "success" və ya "fail" ola bilər.');
  try {
    const historyCheck = await executeQuery(`SELECT id, abunelik_id, istifadeci_id FROM odenis_tarixcesi WHERE id = :id`, { id });
    if (historyCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'PAYMENT_NOT_FOUND', 'Ödəniş tarixçəsi tapılmadı.');
    const { ABUNELIK_ID: currentAbunelikId, ISTIFADECI_ID: currentIstifadeciId } = historyCheck.rows[0];
    if (req.body.odenis_tarixcesi_id !== undefined && Number(req.body.odenis_tarixcesi_id) !== Number(id)) return errorResponse(res, 400, 'Bad Request', 'ID_IMMUTABLE', 'Ödəniş tarixçəsinin ID-si dəyişdirilə bilməz.');
    if (req.body.istifadeci_id !== undefined && Number(req.body.istifadeci_id) !== Number(currentIstifadeciId)) return errorResponse(res, 400, 'Bad Request', 'USER_IMMUTABLE', 'Ödəniş tarixçəsinin aid olduğu istifadəçi dəyişdirilə bilməz.');
    if (req.body.abunelik_id !== undefined && Number(req.body.abunelik_id) !== Number(currentAbunelikId)) return errorResponse(res, 400, 'Bad Request', 'SUBSCRIPTION_IMMUTABLE', 'Ödəniş tarixçəsinin aid olduğu abunəlik dəyişdirilə bilməz.');
    await executeQuery(`UPDATE odenis_tarixcesi SET abunelik_id=:abunelik_id, odenis_tarixi=TO_DATE(:odenis_tarixi,'YYYY-MM-DD'), mebleq=:mebleq, status=:status WHERE id=:id`,
      { abunelik_id: currentAbunelikId, odenis_tarixi, mebleq, status: statusValue, id }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Ödəniş tarixçəsi uğurla yeniləndi.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-tarixcesi/{id}:
 *   delete:
 *     summary: Ödəniş tarixçəsi qeydini silir
 *     tags: [Ödəniş Tarixçəsi]
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
app.delete('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(`DELETE FROM odenis_tarixcesi WHERE id = :id`, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'PAYMENT_NOT_FOUND', 'Ödəniş tarixçəsi tapılmadı.');
    return successResponse(res, 200, 'Deleted', { message: 'Ödəniş tarixçəsi uğurla silindi.' });
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
 *     summary: İstifadəçinin ödəniş metodlarını siyahılayır
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/odenis-metodlari', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'istifadeci_id sorğu parametri məcburidir.');
  try {
    const sql = `SELECT id AS card_id, istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status FROM odenis_metodlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) return successResponse(res, 200, 'No payment methods found', { cards: [] });
    return successResponse(res, 200, 'Success', { cards: result.rows });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari/{id}:
 *   get:
 *     summary: ID-yə görə ödəniş metodunu gətirir
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *       404:
 *         description: Tapılmadı
 */
app.get('/api/odenis-metodlari/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id AS card_id, istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status FROM odenis_metodlari WHERE id = :id`;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'CARD_NOT_FOUND', 'Ödəniş metodu tapılmadı.');
    return successResponse(res, 200, 'Success', { card: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/odenis-metodlari:
 *   post:
 *     summary: Yeni ödəniş metodu (kart) əlavə edir
 *     tags: [Ödəniş Metodları]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - istifadeci_id
 *               - ad
 *               - kart_tipi
 *             properties:
 *               istifadeci_id:
 *                 type: integer
 *               ad:
 *                 type: string
 *                 example: Maaş Kartı
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *                 example: Visa
 *               son_dord_reqem:
 *                 type: string
 *                 example: "1234"
 *               kart_istifade_tarixi:
 *                 type: string
 *                 example: "12/28"
 *     responses:
 *       201:
 *         description: Ödəniş metodu yaradıldı
 */
app.post('/api/odenis-metodlari', async (req, res) => {
  const { istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi } = req.body;
  if (!istifadeci_id || !ad || !kart_tipi) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'istifadeci_id, ad və kart_tipi sahələri məcburidir.');

  const ICAZE_VERILEN_KARTLAR = ['visa','mastercard','maestro','unionpay','american express','amex','birkart','tamkart','bolkart','ucard'];
  const KART_FORMATLARI = { 'visa':'Visa','mastercard':'Mastercard','maestro':'Maestro','unionpay':'UnionPay','american express':'American Express','amex':'American Express','birkart':'Birkart','tamkart':'Tamkart','bolkart':'Bolkart','ucard':'Ucard' };
  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_TYPE', `Yanlış kart növü: "${kart_tipi}". Yalnız Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard icazəlidir.`);

  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    await executeQuery(
      `INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi) VALUES (:istifadeci_id, :ad, :kart_tipi, :son_dord_reqem, :kart_istifade_tarixi)`,
      { istifadeci_id, ad, kart_tipi: KART_FORMATLARI[normalizedKartTipi], son_dord_reqem: son_dord_reqem || null, kart_istifade_tarixi: kart_istifade_tarixi || null }, { autoCommit: true }
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
 *     summary: Ödəniş metodunu yeniləyir
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
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *                 example: Visa
 *               son_dord_reqem:
 *                 type: string
 *                 example: "1234"
 *               kart_istifade_tarixi:
 *                 type: string
 *                 example: "12/28"
 *               status:
 *                 type: string
 *                 example: active
 *     responses:
 *       200:
 *         description: Yeniləndi
 */
app.put('/api/odenis-metodlari/:id', async (req, res) => {
  const { id } = req.params;
  const { ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status } = req.body;
  if (!ad || !kart_tipi) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'ad və kart_tipi sahələri məcburidir.');

  const ICAZE_VERILEN_KARTLAR = ['visa','mastercard','maestro','unionpay','american express','amex','birkart','tamkart','bolkart','ucard'];
  const KART_FORMATLARI = { 'visa':'Visa','mastercard':'Mastercard','maestro':'Maestro','unionpay':'UnionPay','american express':'American Express','amex':'American Express','birkart':'Birkart','tamkart':'Tamkart','bolkart':'Bolkart','ucard':'Ucard' };
  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi))
    return errorResponse(res, 400, 'Bad Request', 'INVALID_CARD_TYPE', `Yanlış kart növü: "${kart_tipi}". Yalnız Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard icazəlidir.`);

  try {
    const result = await executeQuery(
      `UPDATE odenis_metodlari SET ad=:ad, kart_tipi=:kart_tipi, son_dord_reqem=:son_dord_reqem, kart_istifade_tarixi=:kart_istifade_tarixi, status=:status WHERE id=:id`,
      { ad, kart_tipi: KART_FORMATLARI[normalizedKartTipi], son_dord_reqem: son_dord_reqem || null, kart_istifade_tarixi: kart_istifade_tarixi || null, status: status || 'active', id }, { autoCommit: true }
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
 */
app.delete('/api/odenis-metodlari/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await executeQuery(`DELETE FROM odenis_metodlari WHERE id = :id`, { id }, { autoCommit: true });
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
 *     summary: İstifadəçinin büdcə limitlərini siyahılayır
 *     tags: [Büdcələr]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/budceler', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) return errorResponse(res, 400, 'Bad Request', 'MISSING_PARAMETER', 'istifadeci_id sorğu parametri məcburidir.');
  try {
    const sql = `SELECT istifadeci_id, limit_mebleq, valyuta, bildiris_faizi FROM budceler WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
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
 *     summary: Yeni büdcə limiti əlavə edir
 *     tags: [Büdcələr]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - istifadeci_id
 *               - limit_mebleq
 *             properties:
 *               istifadeci_id:
 *                 type: integer
 *               limit_mebleq:
 *                 type: number
 *                 example: 50.00
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               bildiris_faizi:
 *                 type: number
 *                 example: 90.00
 *     responses:
 *       201:
 *         description: Yaradıldı
 */
app.post('/api/budceler', async (req, res) => {
  const { istifadeci_id, limit_mebleq, valyuta, bildiris_faizi } = req.body;
  if (!istifadeci_id || limit_mebleq === undefined) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'istifadeci_id və limit_mebleq sahələri məcburidir.');
  if (valyuta && !isValidCurrency(valyuta)) return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);
  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    await executeQuery(
      `INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, bildiris_faizi) VALUES (:istifadeci_id, :limit_mebleq, :valyuta, :bildiris_faizi)`,
      { istifadeci_id, limit_mebleq, valyuta: getValidCurrency(valyuta), bildiris_faizi: bildiris_faizi || 90.00 }, { autoCommit: true }
    );
    return successResponse(res, 201, 'Created', { message: 'Büdcə limiti uğurla quraşdırıldı.' });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/budceler/{id}:
 *   put:
 *     summary: Büdcə limitini yeniləyir
 *     tags: [Büdcələr]
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
 *               - limit_mebleq
 *             properties:
 *               limit_mebleq:
 *                 type: number
 *                 example: 75.00
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               bildiris_faizi:
 *                 type: number
 *                 example: 95.00
 *     responses:
 *       200:
 *         description: Yeniləndi
 */
app.put('/api/budceler/:id', async (req, res) => {
  const { id } = req.params;
  const { limit_mebleq, valyuta, bildiris_faizi } = req.body;
  if (limit_mebleq === undefined) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'limit_mebleq sahəsi məcburidir.');
  if (valyuta && !isValidCurrency(valyuta)) return errorResponse(res, 400, 'Bad Request', 'INVALID_CURRENCY', `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`);
  try {
    const result = await executeQuery(
      `UPDATE budceler SET limit_mebleq=:limit_mebleq, valyuta=:valyuta, bildiris_faizi=:bildiris_faizi WHERE id=:id`,
      { limit_mebleq, valyuta: getValidCurrency(valyuta), bildiris_faizi: bildiris_faizi || 90.00, id }, { autoCommit: true }
    );
    if (result.rowsAffected === 0) return errorResponse(res, 404, 'Not Found', 'BUDGET_NOT_FOUND', 'Büdcə limiti tapılmadı.');
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
 * /api/ayarlar/{istifadeci_id}:
 *   get:
 *     summary: İstifadəçinin fərdi ayarlarını gətirir
 *     tags: [Ayarlar]
 *     parameters:
 *       - in: path
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/ayarlar/:istifadeci_id', async (req, res) => {
  const { istifadeci_id } = req.params;
  try {
    const sql = `SELECT istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) {
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:istifadeci_id, 'AZN', 'email', 'az', 'dark')`,
        { istifadeci_id }, { autoCommit: true }
      );
      return successResponse(res, 200, 'Success', { settings: { istifadeci_id: Number(istifadeci_id), esas_valyuta: 'AZN', bildiris_metodu: 'email', dil: 'az', tema: 'dark' } });
    }
    return successResponse(res, 200, 'Success', { settings: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message);
  }
});

/**
 * @swagger
 * /api/ayarlar/{istifadeci_id}:
 *   put:
 *     summary: İstifadəçinin fərdi ayarlarını yeniləyir
 *     tags: [Ayarlar]
 *     parameters:
 *       - in: path
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
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
 */
app.put('/api/ayarlar/:istifadeci_id', async (req, res) => {
  const { istifadeci_id } = req.params;
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
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');

    const settingsCheck = await executeQuery(`SELECT istifadeci_id FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`, { istifadeci_id });
    let sql;
    if (settingsCheck.rows.length > 0) {
      sql = `UPDATE istifadeci_ayarlari SET esas_valyuta=:esas_valyuta, bildiris_metodu=:bildiris_metodu, dil=:dil, tema=:tema WHERE istifadeci_id=:istifadeci_id`;
    } else {
      sql = `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema) VALUES (:istifadeci_id, :esas_valyuta, :bildiris_metodu, :dil, :tema)`;
    }
    await executeQuery(sql, {
      istifadeci_id,
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

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Swagger documentation is available on http://localhost:${PORT}/api-docs`);
});
