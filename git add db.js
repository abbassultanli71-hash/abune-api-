[1mdiff --cc server.js[m
[1mindex 0b46284,8af802e..0000000[m
[1m--- a/server.js[m
[1m+++ b/server.js[m
[36m@@@ -60,16 -59,16 +60,28 @@@[m [mconst swaggerOptions = [m
      openapi: '3.0.0',[m
      info: {[m
        title: 'Abunəlik İdarəetmə Platforması API',[m
[32m++<<<<<<< HEAD[m
[32m +      version: '1.1.0',[m
[32m +      description: 'Oracle verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı. Bütün istifadəçi-aid endpointlər "username" üzərindən işləyir.',[m
[32m +    },[m
[32m +    servers: [[m
[32m +      { url: '/', description: 'Cari Server (Lokal və ya Tunel)' },[m
[32m++=======[m
[32m+       version: '2.0.0',[m
[32m+       description: 'PostgreSQL verilənlər bazası ilə inteqrasiya olunmuş abunəlik idarəetmə platformasının API-ı.',[m
[32m+     },[m
[32m+     servers: [[m
[32m+       { url: '/', description: 'Cari Server' },[m
[32m++>>>>>>> checkpoint[m
        { url: `http://localhost:${PORT}`, description: 'Yerli API Serveri' },[m
      ],[m
      components: {[m
        securitySchemes: {[m
[32m++<<<<<<< HEAD[m
[32m +        basicAuth: { type: 'http', scheme: 'basic', description: 'API-ya giriş üçün istifadəçi adı və şifrə daxil edin.' }[m
[32m++=======[m
[32m+         basicAuth: { type: 'http', scheme: 'basic' }[m
[32m++>>>>>>> checkpoint[m
        }[m
      },[m
      security: [{ basicAuth: [] }][m
[36m@@@ -100,73 -100,15 +113,84 @@@[m [mfunction isValidEmail(email) [m
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);[m
  }[m
  [m
[32m++<<<<<<< HEAD[m
[32m +[m
[32m +// Luhn alqoritmi ilə kart nömrəsinin (PAN) düzgünlüyünü yoxlayır.[m
[32m +function isValidPanLuhn(pan) {[m
[32m +  if (typeof pan !== 'string') return false;[m
[32m +  const cleaned = pan.replace(/\s+/g, '');[m
[32m +  if (!/^\d{12,19}$/.test(cleaned)) return false; // əsas format yoxlanışı[m
[32m +[m
[32m +  let sum = 0;[m
[32m +  let shouldDouble = false;[m
[32m +[m
[32m +  for (let i = cleaned.length - 1; i >= 0; i--) {[m
[32m +    let digit = parseInt(cleaned[i], 10);[m
[32m +    if (shouldDouble) {[m
[32m +      digit *= 2;[m
[32m +      if (digit > 9) digit -= 9;[m
[32m +    }[m
[32m +    sum += digit;[m
[32m +    shouldDouble = !shouldDouble;[m
[32m +  }[m
[32m +[m
[32m +  return sum % 10 === 0;[m
[32m +}[m
[32m +[m
[32m +// Kartın istifadə tarixini (MM/YY) yoxlayır.[m
[32m +// Format və "müddət bitib" yoxlamaları AYRI nəticələrlə qaytarılır ki,[m
[32m +// hansı xəta mesajının göstəriləcəyi dəqiq müəyyən olunsun.[m
[32m +// Format yoxlanışı il üçün heç bir aralıq tətbiq etmir (00-99 hamısı format[m
[32m +// baxımından düzgündür) — ilin keçmiş olub-olmaması yalnız aşağıdaki[m
[32m +// "müddət bitib" addımında həll olunur, formatla qarışdırılmır.[m
[32m +function isValidKartTarixi(tarixi) {[m
[32m +  if (!tarixi) return { valid: true };[m
[32m +[m
[32m +  // 1) Format yoxlanışı — Ay: 01-12, İl: hər iki rəqəm (00-99)[m
[32m +  const formatRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;[m
[32m +  if (!formatRegex.test(tarixi)) {[m
[32m +    return { valid: false, reason: 'FORMAT' };[m
[32m +  }[m
[32m +[m
[32m +  // 2) Format düzgündürsə, müddətin bitib-bitmədiyini yoxla[m
[32m +  const [mm, yy] = tarixi.split('/').map(Number);[m
[32m +  const now = new Date();[m
[32m +  const bugunAy = now.getMonth() + 1;[m
[32m +  const bugunIl = now.getFullYear() % 100;[m
[32m +[m
[32m +  if (yy < bugunIl || (yy === bugunIl && mm < bugunAy)) {[m
[32m +    return { valid: false, reason: 'EXPIRED' };[m
[32m +  }[m
[32m +[m
[32m +  return { valid: true };[m
[32m +}[m
[32m +[m
[32m +function isValidUsername(username) {[m
[32m +  if (typeof username !== 'string') return false;[m
[32m +  const trimmed = username.trim();[m
[32m +  return /^[a-zA-Z0-9_.]{3,50}$/.test(trimmed);[m
[32m +}[m
[32m +[m
[32m +// PAN-i cavablarda gostermek ucun maskalayir - yalniz son 4 reqem qalir.[m
[32m +function maskPan(pan) {[m
[32m +  if (!pan || String(pan).length < 4) return null;[m
[32m +  const last4 = String(pan).slice(-4);[m
[32m +  return `**** **** **** ${last4}`;[m
[32m++=======[m
[32m+ function isValidUsername(username) {[m
[32m+   if (typeof username !== 'string') return false;[m
[32m+   return /^[a-zA-Z0-9_.]{3,50}$/.test(username.trim());[m
[32m++>>>>>>> checkpoint[m
  }[m
  [m
  const ICAZE_VERILEN_VALYUTALAR = ['AZN', 'USD', 'EUR'];[m
  const ICAZE_VERILEN_ODENIS_TEZLIKLERI = ['monthly', 'yearly', 'quarterly', 'weekly'];[m
[32m++<<<<<<< HEAD[m
[32m +const ICAZE_VERILEN_KATEQORIYALAR = ['Entertainment', 'Music', 'Education', 'Health & Fitness', 'Productivity', 'Gaming', 'Cloud Storage', 'News', 'Food & Delivery', 'Shopping', 'Finance', 'Other'];[m
[32m++=======[m
[32m+ const ICAZE_VERILEN_KATEQORIYALAR = ['Entertainment', 'Music', 'Education', 'Health & Fitness',[m
[32m+   'Productivity', 'Gaming', 'Cloud Storage', 'News', 'Food & Delivery', 'Shopping', 'Finance', 'Other'];[m
[32m++>>>>>>> checkpoint[m
  const ICAZE_VERILEN_STATUSLAR = ['active', 'deactive'];[m
  [m
  function getValidCurrency(valyuta) {[m
[36m@@@ -180,34 -122,25 +204,54 @@@[m [mfunction isValidCurrency(valyuta) [m
    return ICAZE_VERILEN_VALYUTALAR.includes(getValidCurrency(valyuta));[m
  }[m
  [m
[32m++<<<<<<< HEAD[m
[32m +// İstifadəçinin username-inə görə daxili (Oracle) ID-sini tapır.[m
[32m +// Bütün API endpointləri istifadəçini "username" ilə qəbul edir, daxili sorğularda isə FK üçün bu ID istifadə olunur.[m
[32m +async function getUserIdByUsername(username) {[m
[32m +  if (!username) return null;[m
[32m +  const result = await executeQuery(`SELECT id FROM istifadeciler WHERE username = :username`, { username });[m
[32m++=======[m
[32m+ async function getUserIdByUsername(username) {[m
[32m+   if (!username) return null;[m
[32m+   const result = await executeQuery([m
[32m+     `SELECT id FROM istifadeciler WHERE username = :username`,[m
[32m+     { username }[m
[32m+   );[m
[32m++>>>>>>> checkpoint[m
    if (result.rows.length === 0) return null;[m
    return result.rows[0].ID;[m
  }[m
  [m
[32m++<<<<<<< HEAD[m
[32m +// baslama_tarixi və odenis_tezliyi-nə əsasən növbəti ödəniş tarixini avtomatik hesablayır.[m
[32m +// Bu sahə heç vaxt birbaşa client tərəfindən göndərilmir, həmişə server tərəfindən default olaraq hesablanır.[m
[32m++=======[m
[32m++>>>>>>> checkpoint[m
  function hesablaNovbetiOdenisTarixi(baslamaTarixiStr, odenisTezliyi) {[m
    const [y, m, d] = baslamaTarixiStr.split('-').map(Number);[m
    const next = new Date(Date.UTC(y, m - 1, d));[m
    switch (odenisTezliyi) {[m
[32m++<<<<<<< HEAD[m
[32m +    case 'weekly':[m
[32m +      next.setUTCDate(next.getUTCDate() + 7);[m
[32m +      break;[m
[32m +    case 'quarterly':[m
[32m +      next.setUTCMonth(next.getUTCMonth() + 3);[m
[32m +      break;[m
[32m +    case 'yearly':[m
[32m +      next.setUTCFullYear(next.getUTCFullYear() + 1);[m
[32m +      break;[m
[32m +    case 'monthly':[m
[32m +    default:[m
[32m +      next.setUTCMonth(next.getUTCMonth() + 1);[m
[32m +      break;[m
[32m++=======[m
[32m+     case 'weekly':    next.setUTCDate(next.getUTCDate() + 7); break;[m
[32m+     case 'quarterly': next.setUTCMonth(next.getUTCMonth() + 3); break;[m
[32m+     case 'yearly':    next.setUTCFullYear(next.getUTCFullYear() + 1); break;[m
[32m+     case 'monthly':[m
[32m+     default:          next.setUTCMonth(next.getUTCMonth() + 1); break;[m
[32m++>>>>>>> checkpoint[m
    }[m
    const yyyy = next.getUTCFullYear();[m
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');[m
[36m@@@ -215,19 -148,50 +259,63 @@@[m
    return `${yyyy}-${mm}-${dd}`;[m
  }[m
  [m
[32m++<<<<<<< HEAD[m
[32m +// Standard response helpers[m
[32m++=======[m
[32m++>>>>>>> checkpoint[m
  function successResponse(res, statusCode, message, data) {