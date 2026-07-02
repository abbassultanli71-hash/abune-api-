const cron = require('node-cron');
const { executeQuery } = require('../db');
const { createDueDateNotification } = require('../services/notificationService');

const CRON_SCHEDULE = '0 * * * *';

async function findDueSubscriptions() {
  const sql = `
    SELECT a.id AS abunelik_id, a.istifadeci_id, a.ad,
           TO_CHAR(a.novbeti_odenis_tarixi, 'YYYY-MM-DD') AS novbeti_odenis_tarixi
    FROM abunelikler a
    WHERE a.status = 'active'
      AND a.novbeti_odenis_tarixi <= (TRUNC(SYSDATE) + 1)
      AND NOT EXISTS (
        SELECT 1 FROM bildirisler b
        WHERE b.istifadeci_id = a.istifadeci_id
          AND b.basliq LIKE a.ad || '%'
          AND TRUNC(b.gonderilme_tarixi) = TRUNC(SYSDATE)
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

  console.log(`[subscription-notifier] ${dueSubs.length} abunəlik tapıldı (1 gün və ya az qalıb / gecikib).`);

  const bugun = new Date();
  bugun.setUTCHours(0, 0, 0, 0);

  let created = 0;
  let failed = 0;

  for (const sub of dueSubs) {
    const istifadeciId = sub.ISTIFADECI_ID;
    const appAdi = sub.AD;
    const novbetiTarix = sub.NOVBETI_ODENIS_TARIXI;

    try {
      const [ny, nm, nd] = novbetiTarix.split('-').map(Number);
      const novbetiDate = new Date(Date.UTC(ny, nm - 1, nd));
      const qalanGun = Math.ceil((novbetiDate - bugun) / (1000 * 60 * 60 * 24));

      await createDueDateNotification(istifadeciId, appAdi, novbetiTarix, qalanGun);
      created++;
    } catch (err) {
      failed++;
      console.error(`[subscription-notifier] Xəta (abunelik_id=${sub.ABUNELIK_ID}, appAdi=${appAdi}):`, err.message);
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
