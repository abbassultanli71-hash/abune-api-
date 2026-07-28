const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// 1. syncBudgetSpent funksiyasini elave et
const marker1 = "app.post('/api/abunelikler', async (req, res) => {";
const insertion1 = `async function syncBudgetSpent(userId) {
  try {
    const activeSubs = await executeQuery(
      \`SELECT qiymet FROM abunelikler WHERE istifadeci_id = :userId AND status = 'active'\`,
      { userId }
    );
    let total = 0;
    for (const row of activeSubs.rows) { total += Number(row.QIYMET); }
    await executeQuery(
      \`UPDATE budceler SET hesab_mebleqi = :total WHERE istifadeci_id = :userId\`,
      { total, userId },
      { autoCommit: true }
    );
  } catch (err) {
    console.error('syncBudgetSpent xetasi:', err.message);
  }
}

${marker1}`;
if (!content.includes('async function syncBudgetSpent')) {
  content = content.replace(marker1, insertion1);
  console.log('1) syncBudgetSpent funksiyasi elave edildi.');
} else {
  console.log('1) syncBudgetSpent artiq movcuddur, kecildi.');
}

// 2. POST icinde cagir
const marker2 = `    if (newSubId) {
      await addAutoPaymentHistory(userId, newSubId, parsedQiymet, baslama_tarixi);
    }

    return successResponse(res, 201, 'Created', {`;
const replacement2 = `    if (newSubId) {
      await addAutoPaymentHistory(userId, newSubId, parsedQiymet, baslama_tarixi);
    }

    await syncBudgetSpent(userId);

    return successResponse(res, 201, 'Created', {`;
if (content.includes(marker2)) {
  content = content.replace(marker2, replacement2);
  console.log('2) POST icinde syncBudgetSpent cagirisi elave edildi.');
} else {
  console.log('2) XEBERDARLIQ: POST marker tapilmadi, elave edilmedi.');
}

// 3. PUT icinde cagir
const marker3 = `      { autoCommit: true }
    );
    return successResponse(res, 200, 'Updated', {`;
const replacement3 = `      { autoCommit: true }
    );

    await syncBudgetSpent(userId);

    return successResponse(res, 200, 'Updated', {`;
if (content.includes(marker3)) {
  content = content.replace(marker3, replacement3);
  console.log('3) PUT icinde syncBudgetSpent cagirisi elave edildi.');
} else {
  console.log('3) XEBERDARLIQ: PUT marker tapilmadi, elave edilmedi.');
}

fs.writeFileSync('server.js', content, 'utf8');
console.log('Bitdi. server.js yenilendi.');
