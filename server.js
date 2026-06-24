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

// ZƏMANƏTLİ SWAGGER: Bütün endpointləri birbaşa obyekt şəklində buraya yazdıq ki, şərh xətası olmasın!
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
    security: [{ basicAuth: [] }],
    paths: {
      "/api/istifadeciler/{username}": {
        "get": {
          "summary": "İstifadəçi məlumatlarını gətirir",
          "tags": ["Istifadeciler"],
          "parameters": [{ "name": "username", "in": "path", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Uğurlu" }, "404": { "description": "Tapılmadı" } }
        },
        "put": {
          "summary": "İstifadəçi məlumatlarını yeniləyir",
          "tags": ["Istifadeciler"],
          "parameters": [{ "name": "username", "in": "path", "required": true, "schema": { "type": "string" } }],
          "requestBody": {
            "required": true,
            "content": { "application/json": { "schema": { "type": "object", "properties": { "ad": { "type": "string" }, "email": { "type": "string" } } } } }
          },
          "responses": { "200": { "description": "Yeniləndi" } }
        },
        "delete": {
          "summary": "İstifadəçini silir",
          "tags": ["Istifadeciler"],
          "parameters": [{ "name": "username", "in": "path", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Silindi" } }
        }
      },
      "/api/istifadeciler": {
        "post": {
          "summary": "Yeni istifadəçi yaradır",
          "tags": ["Istifadeciler"],
          "requestBody": {
            "required": true,
            "content": { "application/json": { "schema": { "type": "object", "required": ["username", "ad", "email"], "properties": { "username": { "type": "string" }, "ad": { "type": "string" }, "email": { "type": "string" } } } } }
          },
          "responses": { "201": { "description": "Yaradıldı" } }
        }
      },
      "/api/abunelikler": {
        "get": {
          "summary": "İstifadəçinin abunəliklərini gətirir",
          "tags": ["Abunelikler"],
          "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Uğurlu" } }
        },
        "post": {
          "summary": "Yeni abunəlik əlavə edir",
          "tags": ["Abunelikler"],
          "requestBody": {
            "required": true,
            "content": { "application/json": { "schema": { "type": "object", "required": ["username", "ad", "qiymet", "baslama_tarixi"], "properties": { "username": { "type": "string" }, "ad": { "type": "string" }, "qiymet": { "type": "number" }, "valyuta": { "type": "string" }, "odenis_tezliyi": { "type": "string" }, "baslama_tarixi": { "type": "string" }, "kateqoriya": { "type": "string" } } } } }
          },
          "responses": { "201": { "description": "Yaradıldı" } }
        },
        "put": {
          "summary": "Abunəlik məlumatlarını yeniləyir",
          "tags": ["Abunelikler"],
          "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }, { "name": "ad", "in": "query", "required": true, "schema": { "type": "string" } }],
          "requestBody": {
            "required": true,
            "content": { "application/json": { "schema": { "type": "object", "properties": { "qiymet": { "type": "number" }, "baslama_tarixi": { "type": "string" }, "status": { "type": "string" } } } } }
          },
          "responses": { "200": { "description": "Yeniləndi" } }
        },
        "delete": {
          "summary": "Abunəliyi silir",
          "tags": ["Abunelikler"],
          "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }, { "name": "ad", "in": "query", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Silindi" } }
        }
      },
      "/api/bildirisler": {
        "get": {
          "summary": "İstifadəçinin bildirişlərini gətirir",
          "tags": ["Bildirisler"],
          "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Uğurlu" } }
        }
      },
      "/api/odenis-tarixcesi": {
        "get": {
          "summary": "İstifadəçinin ödəniş tarixçəsini gətirir",
          "tags": ["Odenis Tarixcesi"],
          "parameters": [{ "name": "username", "in": "query", "required": true, "schema": { "type": "string" } }],
          "responses": { "200": { "description": "Uğurlu" } }
        }
      }
    }
  },
  apis: [] // Şərhlərdən oxumağı tamamilə bağladıq
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

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
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

async function addAutoNotification(userId, appAd, novbetiOdenisTarixi, odenisTezliyi) {
  try {
    const [y, m, d] = novbetiOdenisTarixi.split('-').map(Number);
    const gonderilme = new Date(Date.UTC(y, m - 1, d));
    
    switch (odenisTezliyi) {
      case 'weekly':    gonderilme.setUTCDate(gonderilme.getUTCDate() - 2); break;
      case 'monthly':   gonderilme.setUTCDate(gonderilme.getUTCDate() - 3); break;
      case 'quarterly': gonderilme.setUTCDate(gonderilme.getUTCDate() - 7); break;
      case 'yearly':    gonderilme.setUTCDate(gonderilme.getUTCDate() - 14); break;
      default:          gonderilme.setUTCDate(gonderilme.getUTCDate() - 3); break;
    }
    
    const yyyy = gonderilme.getUTCFullYear();
    const mm = String(gonderilme.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(gonderilme.getUTCDate()).padStart(2, '0');
    const gonderilmeTarixiStr = `${yyyy}-${mm}-${dd}`;

    const basliq = `${appAd} Abunəlik Ödəniş Xəbərdarlığı`;
    const mesaj = `Hörmətli istifadəçi, ${appAd} abunəliyiniz üçün növbəti xidmət haqqı ödəniş tarixi yaxınlaşır. Növbəti ödəniş tarixi: ${novbetiOdenisTarixi}.`;

    await executeQuery(
      `INSERT INTO bildirisler (istifadeci_id, basliq, mesaj, gonderilme_tarixi)
       VALUES (:istifadeci_id, :basliq, :mesaj, TO_DATE(:gonderilme_tarixi, 'YYYY-MM-DD'))`,
      { istifadeci_id: userId, basliq, mesaj, gonderilme_tarixi: gonderilmeTarixiStr },
      { autoCommit: true }
    );
    console.log(`[OK] ${appAd} üçün bildiriş bazaya uğurla yazıldı! Tarix: ${gonderilmeTarixiStr}`);
  } catch (err) {
    console.error('Avtomatik bildiriş yazılma xətası:', err.message);
  }
}

async function addAutoPaymentHistory(userId, abunelikId, qiymet, baslamaTarixi) {
  try {
    await executeQuery(
      `INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
       VALUES (:abunelik_id, :istifadeci_id, :odenis_tarixi, :mebleq, 'success')`,
      { abunelik_id: abunelikId, istifadeci_id: userId, odenis_tarixi: baslamaTarixi, mebleq: qiymet },
      { autoCommit: true }
    );
  } catch (err) {
    console.error('Auto payment history error:', err.message);
  }
}

// ── Istifadeciler Routes ─────────────────────────────────────────────────────
app.get('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await executeQuery(
      `SELECT id, username, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
       FROM istifadeciler WHERE username = :username`, { username }
    );
    if (result.rows.length === 0) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    return successResponse(res, 200, 'Success', { user: result.rows[0] });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.post('/api/istifadeciler', async (req, res) => {
  const { username, ad, email } = req.body;
  if (!username || !ad || !email) return errorResponse(res, 400, 'Bad Request', 'MISSING_FIELDS', 'Məcburi sahələr boşdur.');
  try {
    await executeQuery(`INSERT INTO istifadeciler (username, ad, email) VALUES (:username, :ad, :email)`, { username, ad, email }, { autoCommit: true });
    const userResult = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });
    await executeQuery(`INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu) VALUES (:id, 'AZN', 'email')`, { id: userResult.rows[0].ID }, { autoCommit: true });
    return successResponse(res, 201, 'Created', { message: 'İstifadəçi yaradıldı.' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.put('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  const { ad, email } = req.body;
  try {
    await executeQuery(`UPDATE istifadeciler SET ad = :ad, email = :email WHERE username = :username`, { ad, email, username }, { autoCommit: true });
    return successResponse(res, 200, 'Updated', { message: 'Yeniləndi' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.delete('/api/istifadeciler/:username', async (req, res) => {
  const { username } = req.params;
  try {
    await executeQuery(`DELETE FROM istifadeciler WHERE username = :username`, { username }, { autoCommit: true });
    return successResponse(res, 200, 'Deleted', { message: 'Silindi' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

// ── Abunelikler Routes ───────────────────────────────────────────────────────
app.get('/api/abunelikler', async (req, res) => {
  const { username } = req.query;
  try {
    const userId = await getUserIdByUsername(username);
    if (!userId) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    const result = await executeQuery(
      `SELECT id AS abunelik_id, ad, qiymet, valyuta, odenis_tezliyi,
              TO_CHAR(baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
              TO_CHAR(novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi, status
       FROM abunelikler WHERE istifadeci_id = :userId`, { userId }
    );
    return successResponse(res, 200, 'Success', { subscriptions: result.rows });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.post('/api/abunelikler', async (req, res) => {
  const { username, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, kateqoriya } = req.body;
  const odenisTezliyi = odenis_tezliyi || 'monthly';
  const novbetiOdenisTarixi = hesablaNovbetiOdenisTarixi(baslama_tarixi, odenisTezliyi);
  try {
    const userId = await getUserIdByUsername(username);
    if (!userId) return errorResponse(res, 400, 'Bad Request', 'USER_NOT_FOUND', 'İstifadəçi yoxdur.');
    await executeQuery(
      `INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, status)
       VALUES (:userId, :ad, :qiymet, :valyuta, :odenisTezliyi, :baslama_tarixi, :novbetiOdenisTarixi, 'active')`,
      { userId, ad, qiymet, valyuta: getValidCurrency(valyuta), odenisTezliyi, baslama_tarixi, novbetiOdenisTarixi },
      { autoCommit: true }
    );
    const newSub = await executeQuery(`SELECT id FROM abunelikler WHERE istifadeci_id = :userId AND ad = :ad ORDER BY id DESC LIMIT 1`, { userId, ad });
    await addAutoNotification(userId, ad, novbetiOdenisTarixi, odenisTezliyi);
    if (newSub.rows.length > 0) { await addAutoPaymentHistory(userId, newSub.rows[0].ID, qiymet, baslama_tarixi); }
    return successResponse(res, 201, 'Created', { message: 'Abunəlik əlavə edildi.' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.put('/api/abunelikler', async (req, res) => {
  const { username, ad: queryAd } = req.query;
  const { qiymet, baslama_tarixi, status } = req.body;
  const novbetiOdenisTarixi = hesablaNovbetiOdenisTarixi(baslama_tarixi, 'monthly');
  try {
    const userId = await getUserIdByUsername(username);
    await executeQuery(
      `UPDATE abunelikler SET qiymet=:qiymet, baslama_tarixi=:baslama_tarixi, novbeti_odenis_tarixi=:novbetiOdenisTarixi, status=:status
       WHERE istifadeci_id=:userId AND ad=:queryAd`, { qiymet, baslama_tarixi, novbetiOdenisTarixi, status, userId, queryAd }, { autoCommit: true }
    );
    return successResponse(res, 200, 'Updated', { message: 'Yeniləndi' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.delete('/api/abunelikler', async (req, res) => {
  const { username, ad } = req.query;
  try {
    const userId = await getUserIdByUsername(username);
    await executeQuery(`DELETE FROM abunelikler WHERE istifadeci_id = :userId AND ad = :ad`, { userId, ad }, { autoCommit: true });
    return successResponse(res, 200, 'Deleted', { message: 'Silindi.' });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

// ── Bildirisler Routes ───────────────────────────────────────────────────────
app.get('/api/bildirisler', async (req, res) => {
  const { username } = req.query;
  try {
    const userId = await getUserIdByUsername(username);
    if (!userId) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    const result = await executeQuery(
      `SELECT id AS bildiris_id, basliq, mesaj, TO_CHAR(gonderilme_tarixi, 'YYYY-MM-DD HH24:MI:SS') as gonderilme_tarixi
       FROM bildirisler WHERE istifadeci_id = :userId ORDER BY id DESC`, { userId }
    );
    return successResponse(res, 200, 'Success', { notifications: result.rows });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

// ── Odenis Tarixcesi Routes ──────────────────────────────────────────────────
app.get('/api/odenis-tarixcesi', async (req, res) => {
  const { username } = req.query;
  try {
    const userId = await getUserIdByUsername(username);
    if (!userId) return errorResponse(res, 404, 'Not Found', 'USER_NOT_FOUND', 'İstifadəçi tapılmadı.');
    const result = await executeQuery(
      `SELECT o.id AS odenis_tarixcesi_id, a.ad as abunelik_ad, TO_CHAR(o.odenis_tarixi, 'YYYY-MM-DD') as odenis_tarixi, o.mebleq, o.status
       FROM odenis_tarixcesi o JOIN abunelikler a ON o.abunelik_id = a.id
       WHERE o.istifadeci_id = :userId ORDER BY o.odenis_tarixi DESC`, { userId }
    );
    return successResponse(res, 200, 'Success', { paymentHistory: result.rows });
  } catch (err) { return errorResponse(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', err.message); }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
