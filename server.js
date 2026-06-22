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

// Helper to recursively normalize object keys to lowercase
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

// Middleware to normalize request body keys to lowercase
app.use((req, res, next) => {
  if (req.body) {
    req.body = lowercaseKeys(req.body);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Basic Authentication Middleware
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

// Swagger UI configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Abunəlik İdarəetmə Platforması API',
      version: '1.0.0',
      description: 'Oracle verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı.',
    },
    servers: [
      {
        url: '/',
        description: 'Cari Server (Lokal və ya Tunel)',
      },
      {
        url: `http://localhost:${PORT}`,
        description: 'Yerli API Serveri',
      },
    ],
    components: {
      securitySchemes: {
        basicAuth: {
          type: 'http',
          scheme: 'basic',
          description: 'API-ya giriş üçün istifadəçi adı və şifrə daxil edin.'
        }
      }
    },
    security: [
      {
        basicAuth: []
      }
    ]
  },
  apis: ['./server.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', authMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use('/api', authMiddleware);

// Root route serves the admin Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// /app route serves the user-facing Subscription App
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Helper functions for Date and Timestamp validation
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
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

const ICAZE_VERILEN_VALYUTALAR = ['AZN', 'USD', 'EUR'];

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
}

function isValidCurrency(valyuta) {
  const v = getValidCurrency(valyuta);
  return ICAZE_VERILEN_VALYUTALAR.includes(v);
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
 */
app.get('/api/istifadeciler', async (req, res) => {
  try {
    const sql = `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler ORDER BY id`;
    const result = await executeQuery(sql);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *         description: İstifadəçinin ID-si
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - istifadeci_id
 *               properties:
 *                 ID:
 *                   type: integer
 *                 AD:
 *                   type: string
 *                 EMAIL:
 *                   type: string
 *                 YARADILMA_TARIXI:
 *                   type: string
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.get('/api/istifadeciler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE id = :id`;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *                 description: İstifadəçinin ID-si (isteğe bağlı)
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
  
  if (!ad || !email) {
    return res.status(400).json({ error: 'Ad və email sahələri məcburidir.' });
  }

  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (trimmedAd.length === 0 || trimmedEmail.length === 0) {
    return res.status(400).json({ error: 'Ad və email sahələri boş qoyula bilməz.' });
  }

  if (trimmedAd.length < 3 || trimmedAd.length > 100) {
    return res.status(400).json({ error: 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.' });
  }

  if (!isValidEmail(trimmedEmail)) {
    return res.status(400).json({ error: 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).' });
  }

  if (trimmedEmail.length > 100) {
    return res.status(400).json({ error: 'Email ən çoxu 100 simvoldan ibarət olmalıdır.' });
  }

  if (id !== undefined && id !== null) {
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({ error: 'ID yalnız müsbət tam ədəd olmalıdır.' });
    }
  }

  try {
    // ID yoxlanışı (əgər ID daxil edilibsə)
    if (history_id) {
      const idCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :id`, { id });
      if (idCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Bu ID ilə artıq istifadəçi mövcuddur.' });
      }
    }

    // Email yoxlanışı
    const emailCheck = await executeQuery(`SELECT email FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.' });
    }

    let sql;
    let binds;
    if (history_id) {
      sql = `INSERT INTO istifadeciler (id, ad, email) VALUES (:id, :ad, :email)`;
      binds = { id, ad: trimmedAd, email: trimmedEmail };
    } else {
      sql = `INSERT INTO istifadeciler (ad, email) VALUES (:ad, :email)`;
      binds = { ad: trimmedAd, email: trimmedEmail };
    }
    await executeQuery(sql, binds, { autoCommit: true });

    // 1. Yeni yaradılan istifadəçinin ID-sini tapırıq (email unikal olduğu üçün)
    const userResult = await executeQuery(`SELECT id FROM istifadeciler WHERE email = :email`, { email: trimmedEmail });
    const userId = userResult.rows[0].ID;

    // 2. Bu istifadəçi üçün avtomatik olaraq default ayarlar yaradırıq
    await executeQuery(`
      INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
      VALUES (:userId, 'AZN', 'email', 'az', 'dark')
    `, { userId }, { autoCommit: true });

    res.status(201).json({ message: 'İstifadəçi və onun ilkin ayarları uğurla yaradıldı.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) {
      return res.status(400).json({ error: 'Məlumatların unikallığı pozuldu (eyni ID və ya email artıq mövcuddur).' });
    }
    res.status(500).json({ error: err.message });
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
 *         description: İstifadəçinin ID-si
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
 *                 description: Yaradılma tarixi (YYYY-MM-DD HH24:MI:SS formatında)
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
  if (!ad || !email) {
    return res.status(400).json({ error: 'Ad və email sahələri məcburidir.' });
  }

  const trimmedAd = String(ad).trim();
  const trimmedEmail = String(email).trim();

  if (trimmedAd.length === 0 || trimmedEmail.length === 0) {
    return res.status(400).json({ error: 'Ad və email sahələri boş qoyula bilməz.' });
  }

  if (trimmedAd.length < 3 || trimmedAd.length > 100) {
    return res.status(400).json({ error: 'Ad ən azı 3 və ən çoxu 100 simvoldan ibarət olmalıdır.' });
  }

  if (!isValidEmail(trimmedEmail)) {
    return res.status(400).json({ error: 'Email ünvanının formatı yanlışdır (nümunə: ad@example.com).' });
  }

  if (trimmedEmail.length > 100) {
    return res.status(400).json({ error: 'Email ən çoxu 100 simvoldan ibarət olmalıdır.' });
  }

  if (yaradilma_tarixi && !isValidTimestamp(yaradilma_tarixi)) {
    return res.status(400).json({ error: `Yaradılma tarixi düzgün deyil: "${yaradilma_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD HH24:MI:SS).` });
  }

  if (req.body.id !== undefined && Number(req.body.id) !== Number(id)) {
    return res.status(400).json({ error: 'İstifadəçinin ID-si dəyişdirilə bilməz.' });
  }

  try {
    let sql;
    let binds;
    
    if (yaradilma_tarixi) {
      sql = `UPDATE istifadeciler SET ad = :ad, email = :email, yaradilma_tarixi = TO_TIMESTAMP(:yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') WHERE id = :id`;
      binds = { ad: trimmedAd, email: trimmedEmail, yaradilma_tarixi, id };
    } else {
      sql = `UPDATE istifadeciler SET ad = :ad, email = :email WHERE id = :id`;
      binds = { ad: trimmedAd, email: trimmedEmail, id };
    }
    
    const result = await executeQuery(sql, binds, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }

    // Yenilənmiş istifadəçinin məlumatlarını bazadan gətirib cavabda qaytarırıq
    const updated = await executeQuery(
      `SELECT id, ad, email, TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi FROM istifadeciler WHERE id = :id`,
      { id }
    );
    res.json({ message: 'İstifadəçi uğurla yeniləndi.', istifadeci: updated.rows[0] });
  } catch (err) {
    // Eyni ID və ya email-in təkrar istifadəsi xətası (Unique/Primary Key Constraint)
    if (err.message && err.message.includes('ORA-00001')) {
      if (err.message.includes('ISTIFADECILER') && err.message.includes('ID') || err.message.includes('SYS_')) {
        if (err.message.includes('EMAIL')) {
          return res.status(400).json({ error: 'Bu email ünvanı ilə artıq istifadəçi mövcuddur.' });
        }
        return res.status(400).json({ error: 'Bu ID ilə artıq başqa bir istifadəçi mövcuddur.' });
      }
      return res.status(400).json({ error: 'Məlumatların unikallığı pozuldu (eyni ID və ya email artıq mövcuddur).' });
    }
    
    // Xarici açar (Foreign Key) məhdudiyyəti xətası
    if (err.message && err.message.includes('ORA-02292')) {
      return res.status(400).json({ error: 'İstifadəçinin abunəliyi və ya bildirişi olduğu üçün onun ID-sini dəyişmək olmaz (Foreign Key Constraint).' });
    }
    
    res.status(500).json({ error: err.message });
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
 *         description: İstifadəçinin ID-si
 *     responses:
 *       200:
 *         description: İstifadəçi silindi
 *       404:
 *         description: İstifadəçi tapılmadı
 */
app.delete('/api/istifadeciler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `DELETE FROM istifadeciler WHERE id = :id`;
    const result = await executeQuery(sql, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }
    res.json({ message: 'İstifadəçi uğurla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// --- ABUNELIKLER (Subscriptions) ROUTES ---
// =============================================

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
 *         description: Abunəliyin ID-si
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - istifadeci_id
 *               properties:
 *                 ID:
 *                   type: integer
 *                 ISTIFADECI_ID:
 *                   type: integer
 *                 AD:
 *                   type: string
 *                 QIYMET:
 *                   type: number
 *                 VALYUTA:
 *                   type: string
 *                 ODENIS_TEZLIYI:
 *                   type: string
 *                 BASLAMA_TARIXI:
 *                   type: string
 *                 NOVBETI_ODENIS_TARIXI:
 *                   type: string
 *                 KATEQORIYA:
 *                   type: string
 *                 STATUS:
 *                   type: string
 *                 YARADILMA_TARIXI:
 *                   type: string
 *       404:
 *         description: Abunəlik tapılmadı
 */
app.get('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi,
             TO_CHAR(baslama_tarixi, 'YYYY-MM-DD') as baslama_tarixi,
             TO_CHAR(novbeti_odenis_tarixi, 'YYYY-MM-DD') as novbeti_odenis_tarixi,
             kateqoriya, status,
             TO_CHAR(yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS') as yaradilma_tarixi
      FROM abunelikler WHERE id = :id
    `;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Abunəlik tapılmadı.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *               id:
 *                 type: integer
 *                 description: Abunəliyin ID-si (isteğe bağlı)
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
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               odenis_tezliyi:
 *                 type: string
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
 *                 description: Yaradılma tarixi (YYYY-MM-DD HH24:MI:SS formatında, isteğe bağlı)
 *                 example: "2026-06-19 10:00:00"
 *     responses:
 *       201:
 *         description: Abunəlik əlavə edildi
 */
app.post('/api/abunelikler', async (req, res) => {
  const { id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status, yaradilma_tarixi } = req.body;
  if (!istifadeci_id || !ad || !qiymet || !baslama_tarixi || !novbeti_odenis_tarixi) {
    return res.status(400).json({ error: 'Məcburi sahələri (istifadeci_id, ad, qiymet, baslama_tarixi, novbeti_odenis_tarixi) doldurun.' });
  }
  if (valyuta && !isValidCurrency(valyuta)) {
    return res.status(400).json({ error: `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.` });
  }
  if (!isValidDate(baslama_tarixi)) {
    return res.status(400).json({ error: `Başlama tarixi düzgün deyil: "${baslama_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }
  if (!isValidDate(novbeti_odenis_tarixi)) {
    return res.status(400).json({ error: `Növbəti ödəniş tarixi düzgün deyil: "${novbeti_odenis_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }
  if (yaradilma_tarixi && !isValidTimestamp(yaradilma_tarixi)) {
    return res.status(400).json({ error: `Yaradılma tarixi düzgün deyil: "${yaradilma_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD HH24:MI:SS).` });
  }
  try {
    // İstifadəçinin mövcudluğunu yoxlayırıq
    const userCheckSql = `SELECT id FROM istifadeciler WHERE id = :istifadeci_id`;
    const userCheckResult = await executeQuery(userCheckSql, { istifadeci_id });
    if (userCheckResult.rows.length === 0) {
      return res.status(400).json({ error: 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.' });
    }

    let sql;
    let binds;

    const yaradilmaCol = yaradilma_tarixi ? ', yaradilma_tarixi' : '';
    const yaradilmaVal = yaradilma_tarixi ? `, TO_TIMESTAMP(:yaradilma_tarixi, 'YYYY-MM-DD HH24:MI:SS')` : '';

    if (history_id) {
      sql = `
        INSERT INTO abunelikler (id, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status${yaradilmaCol})
        VALUES (:id, :istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'), :kateqoriya, :status${yaradilmaVal})
      `;
      binds = {
        id, istifadeci_id, ad, qiymet,
        valyuta: getValidCurrency(valyuta),
        odenis_tezliyi: odenis_tezliyi || 'monthly',
        baslama_tarixi, novbeti_odenis_tarixi,
        kateqoriya: kateqoriya || null,
        status: status || 'active',
        ...(yaradilma_tarixi && { yaradilma_tarixi })
      };
    } else {
      sql = `
        INSERT INTO abunelikler (istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status${yaradilmaCol})
        VALUES (:istifadeci_id, :ad, :qiymet, :valyuta, :odenis_tezliyi, TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'), TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'), :kateqoriya, :status${yaradilmaVal})
      `;
      binds = {
        istifadeci_id, ad, qiymet,
        valyuta: getValidCurrency(valyuta),
        odenis_tezliyi: odenis_tezliyi || 'monthly',
        baslama_tarixi, novbeti_odenis_tarixi,
        kateqoriya: kateqoriya || null,
        status: status || 'active',
        ...(yaradilma_tarixi && { yaradilma_tarixi })
      };
    }

    await executeQuery(sql, binds, { autoCommit: true });
    res.status(201).json({ message: 'Abunəlik uğurla əlavə edildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) {
      return res.status(400).json({ error: 'Bu abunəlik ID-si artıq mövcuddur.' });
    }
    res.status(500).json({ error: err.message });
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
 *         description: Abunəliyin ID-si
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
 *               valyuta:
 *                 type: string
 *                 example: AZN
 *               odenis_tezliyi:
 *                 type: string
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
 * */
app.put('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  const { id: bodyId, istifadeci_id, ad, qiymet, valyuta, odenis_tezliyi, baslama_tarixi, novbeti_odenis_tarixi, kateqoriya, status } = req.body;
  
  if (!ad || !qiymet || !baslama_tarixi || !novbeti_odenis_tarixi) {
    return res.status(400).json({ error: 'Məcburi sahələri (ad, qiymet, baslama_tarixi, novbeti_odenis_tarixi) doldurun.' });
  }

  if (bodyId && Number(bodyId) !== Number(id)) {
    return res.status(400).json({ error: 'Abunəliyin ID-si dəyişdirilə bilməz.' });
  }

  if (valyuta && !isValidCurrency(valyuta)) {
    return res.status(400).json({ error: `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.` });
  }

  if (!isValidDate(baslama_tarixi)) {
    return res.status(400).json({ error: `Başlama tarixi düzgün deyil: "${baslama_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }

  if (!isValidDate(novbeti_odenis_tarixi)) {
    return res.status(400).json({ error: `Növbəti ödəniş tarixi düzgün deyil: "${novbeti_odenis_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }

  try {
    // 1. Abunəliyin mövcudluğunu yoxlayırıq
    const subCheckSql = `SELECT id, istifadeci_id FROM abunelikler WHERE id = :id`;
    const subCheckResult = await executeQuery(subCheckSql, { id });
    if (subCheckResult.rows.length === 0) {
      return res.status(404).json({ error: 'Abunəlik tapılmadı.' });
    }
    const currentSub = subCheckResult.rows[0];

    // 2. İstifadəçinin (istifadeci_id) dəyişdirilməməsini yoxlayırıq
    if (istifadeci_id !== undefined && Number(istifadeci_id) !== Number(currentSub.ISTIFADECI_ID)) {
      return res.status(400).json({ error: 'Abunəliyin aid olduğu istifadəçi (istifadeci_id) dəyişdirilə bilməz.' });
    }

    const sql = `
      UPDATE abunelikler SET
        ad = :ad, qiymet = :qiymet, valyuta = :valyuta,
        odenis_tezliyi = :odenis_tezliyi, baslama_tarixi = TO_DATE(:baslama_tarixi, 'YYYY-MM-DD'),
        novbeti_odenis_tarixi = TO_DATE(:novbeti_odenis_tarixi, 'YYYY-MM-DD'),
        kateqoriya = :kateqoriya, status = :status
      WHERE id = :id
    `;
    const binds = {
      ad, qiymet,
      valyuta: getValidCurrency(valyuta),
      odenis_tezliyi: odenis_tezliyi || 'monthly',
      baslama_tarixi, novbeti_odenis_tarixi,
      kateqoriya: kateqoriya || null,
      status: status || 'active',
      id
    };

    await executeQuery(sql, binds, { autoCommit: true });
    res.json({ message: 'Abunəlik uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *         description: Abunəliyin ID-si
 *     responses:
 *       200:
 *         description: Abunəlik silindi
 *       404:
 *         description: Abunəlik tapılmadı
 */
app.delete('/api/abunelikler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `DELETE FROM abunelikler WHERE id = :id`;
    const result = await executeQuery(sql, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Abunəlik tapılmadı.' });
    }
    res.json({ message: 'Abunəlik uğurla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// --- BILDIRISLER (Notifications) ROUTES ---
// =============================================

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
 *         description: Bildirişin ID-si
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - istifadeci_id
 *               properties:
 *                 ID:
 *                   type: integer
 *                 ISTIFADECI_ID:
 *                   type: integer
 *                 BASLIQ:
 *                   type: string
 *                 MESAJ:
 *                   type: string
 *                 GONDERILME_TARIXI:
 *                   type: string
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.get('/api/bildirisler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT id, istifadeci_id, basliq, mesaj,
             TO_CHAR(gonderilme_tarixi, 'YYYY-MM-DD') as gonderilme_tarixi
      FROM bildirisler WHERE id = :id
    `;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bildiriş tapılmadı.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *               id:
 *                 type: integer
 *                 description: Bildirişin ID-si (isteğe bağlı)
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
  const { id, istifadeci_id, basliq, mesaj } = req.body;
  if (!istifadeci_id || !basliq || !mesaj) {
    return res.status(400).json({ error: 'Məcburi sahələri (istifadeci_id, basliq, mesaj) doldurun.' });
  }
  try {
    // İstifadəçinin mövcudluğunu yoxlayırıq
    const userCheckSql = `SELECT id FROM istifadeciler WHERE id = :istifadeci_id`;
    const userCheckResult = await executeQuery(userCheckSql, { istifadeci_id });
    if (userCheckResult.rows.length === 0) {
      return res.status(400).json({ error: 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.' });
    }

    let sql;
    let binds;
    if (history_id) {
      sql = `INSERT INTO bildirisler (id, istifadeci_id, basliq, mesaj) VALUES (:id, :istifadeci_id, :basliq, :mesaj)`;
      binds = { id, istifadeci_id, basliq, mesaj };
    } else {
      sql = `INSERT INTO bildirisler (istifadeci_id, basliq, mesaj) VALUES (:istifadeci_id, :basliq, :mesaj)`;
      binds = { istifadeci_id, basliq, mesaj };
    }

    await executeQuery(sql, binds, { autoCommit: true });
    res.status(201).json({ message: 'Bildiriş uğurla göndərildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) {
      return res.status(400).json({ error: 'Bu bildiriş ID-si artıq mövcuddur.' });
    }
    res.status(500).json({ error: err.message });
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
 *         description: Bildirişin ID-si
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
  if (!basliq || !mesaj) {
    return res.status(400).json({ error: 'Məcburi sahələri (basliq, mesaj) doldurun.' });
  }

  if (req.body.id !== undefined && Number(req.body.id) !== Number(id)) {
    return res.status(400).json({ error: 'Bildirişin ID-si dəyişdirilə bilməz.' });
  }

  try {
    // 1. Bildirişin mövcudluğunu yoxlayırıq
    const checkSql = `SELECT id, istifadeci_id FROM bildirisler WHERE id = :id`;
    const checkResult = await executeQuery(checkSql, { id });
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bildiriş tapılmadı.' });
    }
    const currentNotification = checkResult.rows[0];

    // 2. İstifadəçinin (istifadeci_id) dəyişdirilməməsini yoxlayırıq
    if (req.body.istifadeci_id !== undefined && Number(req.body.istifadeci_id) !== Number(currentNotification.ISTIFADECI_ID)) {
      return res.status(400).json({ error: 'Bildirişin aid olduğu istifadəçi (istifadeci_id) dəyişdirilə bilməz.' });
    }

    const sql = `UPDATE bildirisler SET basliq = :basliq, mesaj = :mesaj WHERE id = :id`;
    const binds = { basliq, mesaj, id };

    await executeQuery(sql, binds, { autoCommit: true });
    res.json({ message: 'Bildiriş uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *         description: Bildirişin ID-si
 *     responses:
 *       200:
 *         description: Bildiriş silindi
 *       404:
 *         description: Bildiriş tapılmadı
 */
app.delete('/api/bildirisler/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `DELETE FROM bildirisler WHERE id = :id`;
    const result = await executeQuery(sql, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Bildiriş tapılmadı.' });
    }
    res.json({ message: 'Bildiriş uğurla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// --- ODENIS TARIXCESI (Payment History) ROUTES ---
// =============================================

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
 *         description: Ödəniş tarixçəsinin ID-si
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - istifadeci_id
 *               properties:
 *                 ID:
 *                   type: integer
 *                 ABUNELIK_ID:
 *                   type: integer
 *                 ISTIFADECI_ID:
 *                   type: integer
 *                 ODENIS_TARIXI:
 *                   type: string
 *                 MEBLEQ:
 *                   type: number
 *                 STATUS:
 *                   type: string
 *                   enum: [success, fail]
 *       404:
 *         description: Ödəniş tarixçəsi tapılmadı
 */
app.get('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT id, abunelik_id, istifadeci_id,
             TO_CHAR(odenis_tarixi, 'YYYY-MM-DD') as odenis_tarixi,
             mebleq, status
      FROM odenis_tarixcesi WHERE id = :id
    `;
    const result = await executeQuery(sql, { id });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ödəniş tarixçəsi tapılmadı.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *               history_id:
 *                 type: integer
 *                 description: Ödəniş tarixçəsinin ID-si (isteğe bağlı)
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
 *         description: Ödəniş tarixçəsi qeydi əlavə edildi
 */
app.post('/api/odenis-tarixcesi', async (req, res) => {
  const { history_id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status } = req.body;
  if (!abunelik_id || !istifadeci_id || !odenis_tarixi || !mebleq) {
    return res.status(400).json({ error: 'Məcburi sahələri (abunelik_id, istifadeci_id, odenis_tarixi, mebleq) doldurun.' });
  }
  if (!isValidDate(odenis_tarixi)) {
    return res.status(400).json({ error: `Ödəniş tarixi düzgün deyil: "${odenis_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }
  const statusValue = status || 'success';
  if (statusValue !== 'success' && statusValue !== 'fail') {
    return res.status(400).json({ error: 'Status yalnız "success" və ya "fail" ola bilər.' });
  }
  try {
    // 1. İstifadəçinin mövcudluğunu yoxlayırıq
    const userCheckSql = `SELECT id FROM istifadeciler WHERE id = :istifadeci_id`;
    const userCheckResult = await executeQuery(userCheckSql, { istifadeci_id });
    if (userCheckResult.rows.length === 0) {
      return res.status(400).json({ error: 'Qeyd olunan istifadəçi (istifadeci_id) mövcud deyil.' });
    }

    // 2. Abunəliyin mövcudluğunu və bu istifadəçiyə aid olub-olmadığını yoxlayırıq
    const subCheckSql = `SELECT id, istifadeci_id FROM abunelikler WHERE id = :abunelik_id`;
    const subCheckResult = await executeQuery(subCheckSql, { abunelik_id });
    if (subCheckResult.rows.length === 0) {
      return res.status(400).json({ error: 'Qeyd olunan abunəlik (abunelik_id) mövcud deyil.' });
    }
    if (Number(subCheckResult.rows[0].ISTIFADECI_ID) !== Number(istifadeci_id)) {
      return res.status(400).json({ error: 'Qeyd olunan abunəlik daxil etdiyiniz istifadəçiyə məxsus deyil.' });
    }

    let sql;
    let binds;
    if (history_id) {
      sql = `
        INSERT INTO odenis_tarixcesi (history_id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
        VALUES (:history_id, :abunelik_id, :istifadeci_id, TO_DATE(:odenis_tarixi, 'YYYY-MM-DD'), :mebleq, :status)
      `;
      binds = { history_id, abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status: statusValue };
    } else {
      sql = `
        INSERT INTO odenis_tarixcesi (abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status)
        VALUES (:abunelik_id, :istifadeci_id, TO_DATE(:odenis_tarixi, 'YYYY-MM-DD'), :mebleq, :status)
      `;
      binds = { abunelik_id, istifadeci_id, odenis_tarixi, mebleq, status: statusValue };
    }

    await executeQuery(sql, binds, { autoCommit: true });
    res.status(201).json({ message: 'Ödəniş tarixçəsi qeydi uğurla əlavə edildi.' });
  } catch (err) {
    if (err.message && err.message.includes('ORA-00001')) {
      return res.status(400).json({ error: 'Bu ödəniş tarixçəsi ID-si artıq mövcuddur.' });
    }
    res.status(500).json({ error: err.message });
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
 *         description: Ödəniş tarixçəsinin ID-si
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
 *         description: Ödəniş tarixçəsi yeniləndi
 *       404:
 *         description: Ödəniş tarixçəsi tapılmadı
 */
app.put('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  const { odenis_tarixi, mebleq, status } = req.body;
  if (!odenis_tarixi || !mebleq) {
    return res.status(400).json({ error: 'Məcburi sahələri (odenis_tarixi, mebleq) doldurun.' });
  }
  if (!isValidDate(odenis_tarixi)) {
    return res.status(400).json({ error: `Ödəniş tarixi düzgün deyil: "${odenis_tarixi}" mövcud olmayan və ya yanlış formatda tarixdir (Format: YYYY-MM-DD).` });
  }
  const statusValue = status || 'success';
  if (statusValue !== 'success' && statusValue !== 'fail') {
    return res.status(400).json({ error: 'Status yalnız "success" və ya "fail" ola bilər.' });
  }
  try {
    // 1. Ödəniş tarixçəsinin mövcudluğunu yoxlayırıq və cari məlumatları əldə edirik
    const historyCheckSql = `SELECT id, abunelik_id, istifadeci_id FROM odenis_tarixcesi WHERE id = :id`;
    const historyCheckResult = await executeQuery(historyCheckSql, { id });
    if (historyCheckResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ödəniş tarixçəsi tapılmadı.' });
    }
    const currentHistory = historyCheckResult.rows[0];
    const currentAbunelikId = currentHistory.ABUNELIK_ID;
    const currentIstifadeciId = currentHistory.ISTIFADECI_ID;

    // 2. ID-nin body vasitəsilə dəyişdirilməməsini yoxlayırıq
    if (req.body.id !== undefined && Number(req.body.id) !== Number(id)) {
      return res.status(400).json({ error: 'Ödəniş tarixçəsinin ID-si dəyişdirilə bilməz.' });
    }

    // 3. İstifadəçinin (istifadeci_id) body vasitəsilə dəyişdirilməməsini yoxlayırıq
    if (req.body.istifadeci_id !== undefined && Number(req.body.istifadeci_id) !== Number(currentIstifadeciId)) {
      return res.status(400).json({ error: 'Ödəniş tarixçəsinin aid olduğu istifadəçi (istifadeci_id) dəyişdirilə bilməz.' });
    }

    // 4. Abunəliyin (abunelik_id) body vasitəsilə dəyişdirilməməsini yoxlayırıq
    if (req.body.abunelik_id !== undefined && Number(req.body.abunelik_id) !== Number(currentAbunelikId)) {
      return res.status(400).json({ error: 'Ödəniş tarixçəsinin aid olduğu abunəlik (abunelik_id) dəyişdirilə bilməz.' });
    }

    const sql = `
      UPDATE odenis_tarixcesi SET
        abunelik_id = :abunelik_id,
        odenis_tarixi = TO_DATE(:odenis_tarixi, 'YYYY-MM-DD'),
        mebleq = :mebleq,
        status = :status
      WHERE id = :id
    `;
    const result = await executeQuery(sql, { abunelik_id, odenis_tarixi, mebleq, status: statusValue, id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Ödəniş tarixçəsi tapılmadı.' });
    }
    res.json({ message: 'Ödəniş tarixçəsi uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *         description: Ödəniş tarixçəsinin ID-si
 *     responses:
 *       200:
 *         description: Ödəniş tarixçəsi silindi
 *       404:
 *         description: Ödəniş tarixçəsi tapılmadı
 */
app.delete('/api/odenis-tarixcesi/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `DELETE FROM odenis_tarixcesi WHERE id = :id`;
    const result = await executeQuery(sql, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Ödəniş tarixçəsi tapılmadı.' });
    }
    res.json({ message: 'Ödəniş tarixçəsi uğurla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/odenis-metodlari:
 *   get:
 *     summary: İstifadəçinin ödəniş metodlarını (kartlarını) siyahılayır
 *     tags: [Ödəniş Metodları]
 *     parameters:
 *       - in: query
 *         name: istifadeci_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: İstifadəçinin ID-si
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/odenis-metodlari', async (req, res) => {
  const { istifadeci_id } = req.query;
  if (!istifadeci_id) {
    return res.status(400).json({ error: 'istifadeci_id sorğu parametri məcburidir.' });
  }
  try {
    const sql = `SELECT id, istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi, status FROM odenis_metodlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
 *               istifadeci_card_id:
 *                 type: integer
 *               ad:
 *                 type: string
 *                 example: Maaş Kartı
 *               kart_tipi:
 *                 type: string
 *                 enum: [Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard]
 *                 example: Visa
 *                 description: Azərbaycanda istifadə olunan populyar kart növləri
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
  if (!istifadeci_id || !ad || !kart_tipi) {
    return res.status(400).json({ error: 'istifadeci_id, ad və kart_tipi sahələri məcburidir.' });
  }

  // Kart tipi validasiyası
  const ICAZE_VERILEN_KARTLAR = [
    'visa', 'mastercard', 'maestro', 'unionpay', 'american express', 'amex', 
    'birkart', 'tamkart', 'bolkart', 'ucard'
  ];
  const KART_FORMATLARI = {
    'visa': 'Visa',
    'mastercard': 'Mastercard',
    'maestro': 'Maestro',
    'unionpay': 'UnionPay',
    'american express': 'American Express',
    'amex': 'American Express',
    'birkart': 'Birkart',
    'tamkart': 'Tamkart',
    'bolkart': 'Bolkart',
    'ucard': 'Ucard'
  };

  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi)) {
    return res.status(400).json({
      error: `Yanlış kart növü: "${kart_tipi}". Yalnız aşağıdakı kart növləri icazəlidir: Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard.`
    });
  }
  const formattedKartTipi = KART_FORMATLARI[normalizedKartTipi];

  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }

    const sql = `
      INSERT INTO odenis_metodlari (istifadeci_id, ad, kart_tipi, son_dord_reqem, kart_istifade_tarixi)
      VALUES (:istifadeci_id, :ad, :kart_tipi, :son_dord_reqem, :kart_istifade_tarixi)
    `;
    await executeQuery(sql, { 
      istifadeci_id, 
      ad, 
      kart_tipi: formattedKartTipi, 
      son_dord_reqem: son_dord_reqem || null, 
      kart_istifade_tarixi: kart_istifade_tarixi || null 
    }, { autoCommit: true });
    res.status(201).json({ message: 'Ödəniş metodu uğurla əlavə edildi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/odenis-metodlari/{id}:
 *   put:
 *     summary: Ödəniş metodunu (kartı) yeniləyir
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
 *                 description: Azərbaycanda istifadə olunan populyar kart növləri
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
  if (!ad || !kart_tipi) {
    return res.status(400).json({ error: 'ad və kart_tipi sahələri məcburidir.' });
  }

  // Kart tipi validasiyası
  const ICAZE_VERILEN_KARTLAR = [
    'visa', 'mastercard', 'maestro', 'unionpay', 'american express', 'amex', 
    'birkart', 'tamkart', 'bolkart', 'ucard'
  ];
  const KART_FORMATLARI = {
    'visa': 'Visa',
    'mastercard': 'Mastercard',
    'maestro': 'Maestro',
    'unionpay': 'UnionPay',
    'american express': 'American Express',
    'amex': 'American Express',
    'birkart': 'Birkart',
    'tamkart': 'Tamkart',
    'bolkart': 'Bolkart',
    'ucard': 'Ucard'
  };

  const normalizedKartTipi = kart_tipi.trim().toLowerCase();
  if (!ICAZE_VERILEN_KARTLAR.includes(normalizedKartTipi)) {
    return res.status(400).json({
      error: `Yanlış kart növü: "${kart_tipi}". Yalnız aşağıdakı kart növləri icazəlidir: Visa, Mastercard, Maestro, UnionPay, American Express, Birkart, Tamkart, Bolkart, Ucard.`
    });
  }
  const formattedKartTipi = KART_FORMATLARI[normalizedKartTipi];

  try {
    const sql = `
      UPDATE odenis_metodlari SET
        ad = :ad,
        kart_tipi = :kart_tipi,
        son_dord_reqem = :son_dord_reqem,
        kart_istifade_tarixi = :kart_istifade_tarixi,
        status = :status
      WHERE id = :id
    `;
    const result = await executeQuery(sql, { 
      ad, 
      kart_tipi: formattedKartTipi, 
      son_dord_reqem: son_dord_reqem || null, 
      kart_istifade_tarixi: kart_istifade_tarixi || null, 
      status: status || 'active', 
      id 
    }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Ödəniş metodu tapılmadı.' });
    }
    res.json({ message: 'Ödəniş metodu uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const sql = `DELETE FROM odenis_metodlari WHERE id = :id`;
    const result = await executeQuery(sql, { id }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Ödəniş metodu tapılmadı.' });
    }
    res.json({ message: 'Ödəniş metodu uğurla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
  if (!istifadeci_id) {
    return res.status(400).json({ error: 'istifadeci_id sorğu parametri məcburidir.' });
  }
  try {
    const sql = `SELECT id, istifadeci_id, limit_mebleq, valyuta, bildiris_faizi FROM budceler WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  if (!istifadeci_id || limit_mebleq === undefined) {
    return res.status(400).json({ error: 'istifadeci_id və limit_mebleq sahələri məcburidir.' });
  }
  if (valyuta && !isValidCurrency(valyuta)) {
    return res.status(400).json({ error: `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.` });
  }
  try {
    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }

    const sql = `
      INSERT INTO budceler (istifadeci_id, limit_mebleq, valyuta, bildiris_faizi)
      VALUES (:istifadeci_id, :limit_mebleq, :valyuta, :bildiris_faizi)
    `;
    await executeQuery(sql, { 
      istifadeci_id, 
      limit_mebleq, 
      valyuta: getValidCurrency(valyuta), 
      bildiris_faizi: bildiris_faizi || 90.00 
    }, { autoCommit: true });
    res.status(201).json({ message: 'Büdcə limiti uğurla quraşdırıldı.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  if (limit_mebleq === undefined) {
    return res.status(400).json({ error: 'limit_mebleq sahəsi məcburidir.' });
  }
  if (valyuta && !isValidCurrency(valyuta)) {
    return res.status(400).json({ error: `Yanlış valyuta: "${valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.` });
  }
  try {
    const sql = `
      UPDATE budceler SET
        limit_mebleq = :limit_mebleq,
        valyuta = :valyuta,
        bildiris_faizi = :bildiris_faizi
      WHERE id = :id
    `;
    const result = await executeQuery(sql, { 
      limit_mebleq, 
      valyuta: getValidCurrency(valyuta), 
      bildiris_faizi: bildiris_faizi || 90.00, 
      id 
    }, { autoCommit: true });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Büdcə limiti tapılmadı.' });
    }
    res.json({ message: 'Büdcə limiti uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/ayarlar/{istifadeci_id}:
 *   get:
 *     summary: İstifadəçinin fərdi ayarlarını gətirir
 *     tags: [Ayarlar]
 *     responses:
 *       200:
 *         description: Uğurlu əməliyyat
 */
app.get('/api/ayarlar/:istifadeci_id', async (req, res) => {
  const { istifadeci_id } = req.params;
  try {
    const sql = `SELECT id, istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`;
    const result = await executeQuery(sql, { istifadeci_id });
    if (result.rows.length === 0) {
      // Default ayarlar database-ə yazılır (initialize-on-first-access)
      await executeQuery(
        `INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
         VALUES (:istifadeci_id, 'AZN', 'email', 'az', 'dark')`,
        { istifadeci_id },
        { autoCommit: true }
      );
      return res.json({
        istifadeci_id: Number(istifadeci_id),
        esas_valyuta: 'AZN',
        bildiris_metodu: 'email',
        dil: 'az',
        tema: 'dark'
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/ayarlar:
 *   put:
 *     summary: İstifadəçinin fərdi ayarlarını yeniləyir və ya yaradır
 *     tags: [Ayarlar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               istifadeci_id:
 *                 type: integer
 *                 description: Istifad?�inin ID-si
 *               esas_valyuta:
 *                 type: string
 *                 enum: [AZN, USD, EUR]
 *                 example: AZN
 *                 description: Yalnız AZN, USD və ya EUR daxil edilə bilər
 *               bildiris_metodu:
 *                 type: string
 *                 enum: [email, telegram]
 *                 example: email
 *                 description: Yalnız email və ya telegram daxil edilə bilər
 *               dil:
 *                 type: string
 *                 enum: [az, en, ru, tr, de, fr, es, it, pt, ar, zh, ja, ko, hi, nl, pl, sv, no, da, fi, cs, sk, ro, hu, uk, ka, kk, uz, hy, fa, he, id, ms, th, vi, el, bg, hr, sr, lt, lv, et, sl, sq, mk, bs, is, ga, cy, eu, ca, gl, mt, af, sw, tl, bn, ur, ta, te, kn, ml, si, my, km, lo, mn, ne, ps, so, am, ha, yo, ig]
 *                 example: az
 *                 description: ISO 639-1 dil kodu (dünya dilləri)
 *               tema:
 *                 type: string
 *                 enum: [light, dark]
 *                 example: dark
 *                 description: Yalnız light və ya dark daxil edilə bilər
 *     responses:
 *       200:
 *         description: Ayarlar yeniləndi
 */
app.put('/api/ayarlar', async (req, res) => {
  const { istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema } = req.body;
  try {
    // ── Validasiya ──────────────────────────────────────────────────────────
    const ICAZE_VERILEN_VALYUTALAR   = ['AZN', 'USD', 'EUR'];
    const ICAZE_VERILEN_BILDIRISLER  = ['email', 'telegram'];
    const ICAZE_VERILEN_TEMALAR      = ['light', 'dark'];
    const ICAZE_VERILEN_DILLER = [
      'az','en','ru','tr','de','fr','es','it','pt','ar','zh','ja','ko','hi',
      'nl','pl','sv','no','da','fi','cs','sk','ro','hu','uk','ka','kk','uz',
      'hy','fa','he','id','ms','th','vi','el','bg','hr','sr','lt','lv','et',
      'sl','sq','mk','bs','is','ga','cy','eu','ca','gl','mt','af','sw','tl',
      'bn','ur','ta','te','kn','ml','si','my','km','lo','mn','ne','ps','so',
      'am','ha','yo','ig'
    ];

    if (esas_valyuta && !ICAZE_VERILEN_VALYUTALAR.includes(esas_valyuta.toUpperCase())) {
      return res.status(400).json({
        error: `Yanlış valyuta: "${esas_valyuta}". Yalnız ${ICAZE_VERILEN_VALYUTALAR.join(', ')} daxil edilə bilər.`
      });
    }
    if (bildiris_metodu && !ICAZE_VERILEN_BILDIRISLER.includes(bildiris_metodu.toLowerCase())) {
      return res.status(400).json({
        error: `Yanlış bildiriş metodu: "${bildiris_metodu}". Yalnız ${ICAZE_VERILEN_BILDIRISLER.join(', ')} daxil edilə bilər.`
      });
    }
    if (tema && !ICAZE_VERILEN_TEMALAR.includes(tema.toLowerCase())) {
      return res.status(400).json({
        error: `Yanlış tema: "${tema}". Yalnız ${ICAZE_VERILEN_TEMALAR.join(', ')} daxil edilə bilər.`
      });
    }
    if (dil && !ICAZE_VERILEN_DILLER.includes(dil.toLowerCase())) {
      return res.status(400).json({
        error: `Yanlış dil kodu: "${dil}". ISO 639-1 formatında dünya dillərindən biri olmalıdır (məs: az, en, ru, tr, de...).`
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const userCheck = await executeQuery(`SELECT id FROM istifadeciler WHERE id = :istifadeci_id`, { istifadeci_id });
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'İstifadəçi tapılmadı.' });
    }

    const settingsCheck = await executeQuery(`SELECT id FROM istifadeci_ayarlari WHERE istifadeci_id = :istifadeci_id`, { istifadeci_id });
    
    let sql;
    if (settingsCheck.rows.length > 0) {
      sql = `
        UPDATE istifadeci_ayarlari SET
          esas_valyuta = :esas_valyuta,
          bildiris_metodu = :bildiris_metodu,
          dil = :dil,
          tema = :tema
        WHERE istifadeci_id = :istifadeci_id
      `;
    } else {
      sql = `
        INSERT INTO istifadeci_ayarlari (istifadeci_id, esas_valyuta, bildiris_metodu, dil, tema)
        VALUES (:istifadeci_id, :esas_valyuta, :bildiris_metodu, :dil, :tema)
      `;
    }
    
    await executeQuery(sql, {
      istifadeci_id,
      esas_valyuta:    (esas_valyuta    ? esas_valyuta.toUpperCase()    : 'AZN'),
      bildiris_metodu: (bildiris_metodu ? bildiris_metodu.toLowerCase() : 'email'),
      dil:             (dil             ? dil.toLowerCase()             : 'az'),
      tema:            (tema            ? tema.toLowerCase()            : 'dark')
    }, { autoCommit: true });

    res.json({ message: 'Ayarlar uğurla yeniləndi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server start
app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Swagger documentation is available on http://localhost:${PORT}/api-docs`);
});
