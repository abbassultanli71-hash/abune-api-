const { executeQuery } = require('../db');

const XEBERDARLIQ_HEDDI = {
  weekly: 2,
  monthly: 7,
  quarterly: 14,
  yearly: 30
};

function generateDueMessage(appAdi, novbetiTarix, qalanGun) {
  let basliq, mesaj;

  if (qalanGun < 0) {
    basliq = `${appAdi} - Gecikmiş Ödəniş`;
    mesaj = `"${appAdi}" abunəliyinizin ödənişi ${Math.abs(qalanGun)} gün gecikib (son tarix: ${novbetiTarix}). Zəhmət olmasa ödənişi tamamlayın.`;
  } else if (qalanGun === 0) {
    basliq = `${appAdi} - Bu Gün Ödəniş Günüdür`;
    mesaj = `"${appAdi}" abunəliyinizin ödəniş tarixi bu gündür (${novbetiTarix}). Ödənişi tamamlamağı unutmayın.`;
  } else {
    basliq = `${appAdi} - Ödəniş Xatırlatması`;
    mesaj = `"${appAdi}" abunəliyinizin növbəti ödənişinə ${qalanGun} gün qalmışdır (${novbetiTarix}).`;
  }

  return { basliq, mesaj };
}

async function createDueDateNotification(istifadeciId, appAdi, novbetiTarix, qalanGun) {
  const { basliq, mesaj } = generateDueMessage(appAdi, novbetiTarix, qalanGun);

  await executeQuery(
    `INSERT INTO bildirisler (istifadeci_id, basliq, mesaj) VALUES (:istifadeci_id, :basliq, :mesaj)`,
    { istifadeci_id: istifadeciId, basliq, mesaj },
    { autoCommit: true }
  );

  return { basliq, mesaj };
}

module.exports = { createDueDateNotification, generateDueMessage, XEBERDARLIQ_HEDDI };
