const cron = require('node-cron');
const { executeQuery } = require('../db');
const { createDueDateNotification } = require('../services/notificationService');

const CRON_SCHEDULE = '0 * * * *';

/**
 * Ödəniş tezliyinə görə fərqli xəbərdarlıq həddi tətbiq edir:
 * weekly -> 2 gün, monthly -> 7 gün, quarterly -> 14 gün, yearly -> 30 gün.
 * Yəni "1 gün qalıb" bütün abunəliklərə eyni tətbiq olunmur.
 *
 * Oracle SYSDATE / TRUNC → PostgreSQL CURRENT_DATE ilə əvəzləndi.
 * Oracle || string concat → PostgreSQL || (eynidir, amma LIKE ilə çalışır)
 */
async function findDueSubscriptions() {
  const sql = `
    SELECT a.id AS abunelik_id, a.istifadeci_id, a.ad, a.odenis_tezliyi,
           TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') AS novbeti_odenis_tarixi
    FROM abunelikler a
    WHERE a.status = 'active'
      AND a.novbeti_odenis_tarixi <= (
        CURRENT_DATE +
        CASE a.odenis_tezliyi
          WHEN 'weekly'    THEN 2
          WHEN 'monthly'   THEN 7
          WHEN 'quarterly' THEN 14
          WHEN 'yearly'    THEN 30
          ELSE 7
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM bildirisler b
        WHERE b.istifadeci_id = a.istifadeci_id
          AND b.abunelik_id = a.id
          AND b.gonderilme_tarixi = CURRENT_DATE
      )
  `;
  const result = await executeQuery(sql);
  return result.rows;
}

async function runDueSubscriptionCheck() {
  console.log(`[${new Date().toISOString()}] [subscription-notifier] Job başladı...`);

  let dueSubs = [];
  try {
    dueSubs = await findDueSubscriptions();
  } catch (err) {
    console.error('[subscription-notifier] Abunəliklər sorğulanarkən xəta:', err.message);
    return;
  }

  console.log(`[subscription-notifier] ${dueSubs.length} abunəlik tapıldı (öz tezlik həddinə görə).`);

  const bugun = new Date();
  bugun.setUTCHours(0, 0, 0, 0);

  let created = 0;
  let failed = 0;

  for (const sub of dueSubs) {
    const istifadeciId = sub.ISTIFADECI_ID;
    const abunelikId   = sub.ABUNELIK_ID;
    const appAdi       = sub.AD;
    const novbetiTarix = sub.NOVBETI_ODENIS_TARIXI;

    try {
      const [ny, nm, nd] = novbetiTarix.split('-').map(Number);
      const novbetiDate = new Date(Date.UTC(ny, nm - 1, nd));
      const qalanGun = Math.ceil((novbetiDate - bugun) / (1000 * 60 * 60 * 24));

      // abunelik_id də ötürülür ki, bildiriş abunəliyə bağlı olsun
      await createDueDateNotification(istifadeciId, appAdi, novbetiTarix, qalanGun, abunelikId);
      created++;
    } catch (err) {
      failed++;
      console.error(`[subscription-notifier] Xəta (abunelik_id=${abunelikId}, appAdi=${appAdi}):`, err.message);
    }
  }

  console.log(`[subscription-notifier] Job bitdi. Yaradıldı: ${created}, Xəta: ${failed}`);
}

function startDueSubscriptionNotifierJob() {
  cron.schedule(CRON_SCHEDULE, () => {
    runDueSubscriptionCheck().catch(err => {
      console.error('[subscription-notifier] Gözlənilməz xəta:', err.message);
    });
  });
  console.log(`[subscription-notifier] Job planlaşdırıldı: "${CRON_SCHEDULE}".`);
}

module.exports = { startDueSubscriptionNotifierJob, runDueSubscriptionCheck };
