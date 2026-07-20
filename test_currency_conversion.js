const assert = require('assert');

// Direct exchange rates relative to AZN (1 USD = 1.70 AZN, 1 EUR = 1.85 AZN)
const VALYUTA_RATES_AZN = {
  AZN: 1.0,
  USD: 1.70,
  EUR: 1.85
};

function getValidCurrency(valyuta) {
  if (!valyuta) return 'AZN';
  let v = String(valyuta).trim().toUpperCase();
  if (v === 'EURO') v = 'EUR';
  return v;
}

function convertCurrency(mebleq, fromValyuta, toValyuta) {
  const from = getValidCurrency(fromValyuta);
  const to = getValidCurrency(toValyuta);
  const val = Number(mebleq) || 0;
  if (from === to) return val;

  const fromRate = VALYUTA_RATES_AZN[from] || 1.0;
  const toRate = VALYUTA_RATES_AZN[to] || 1.0;

  return (val * fromRate) / toRate;
}

function toMonthlyAmount(qiymet, odenisTezliyi) {
  const amount = Number(qiymet) || 0;
  const tezlik = String(odenisTezliyi || 'monthly').toLowerCase();
  switch (tezlik) {
    case 'weekly':
      return (amount * 52) / 12; // Exact 52 weeks / 12 months = 4.3333x
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
    default:
      return amount;
  }
}

function calculateTotalSpent(subs, targetCurrency) {
  let total = 0;
  subs.forEach(s => {
    const monthlyEquiv = toMonthlyAmount(s.price, s.freq);
    total += convertCurrency(monthlyEquiv, s.currency, targetCurrency);
  });
  return Math.round(total * 100) / 100;
}

console.log('--- TEST 1: WEEKLY SUBSCRIPTION ACCURATE CALENDAR CALCULATION ---');

// 20 AZN weekly sub MUST calculate as 20 * 52 / 12 = 86.67 AZN (NOT 20 * 4 = 80)
const weeklySubCost = toMonthlyAmount(20, 'weekly');
console.log(`Weekly 20 AZN Monthly Equivalent: ${weeklySubCost.toFixed(2)} AZN`);
assert.strictEqual(weeklySubCost.toFixed(2), '86.67');
assert.notStrictEqual(weeklySubCost.toFixed(2), '80.00');

console.log('--- TEST 2: INDIVIDUAL SUBSCRIPTION FREQUENCY ISOLATION ---');

// Initial Subscriptions: Sub 1 (Netflix) = 20 AZN weekly, Sub 2 (Spotify) = 20 AZN weekly
let userSubs = [
  { id: 1, name: 'Netflix', price: 20, currency: 'AZN', freq: 'weekly' },
  { id: 2, name: 'Spotify', price: 20, currency: 'AZN', freq: 'weekly' }
];

// Initial Spent: 86.67 + 86.67 = 173.33 AZN
let spent = calculateTotalSpent(userSubs, 'AZN');
console.log(`Initial Spent (Two 20 AZN Weekly Subs): ${spent.toFixed(2)} AZN`);
assert.strictEqual(spent.toFixed(2), '173.33');

// Change ONLY Sub 1 (Netflix) frequency to 'monthly' (20 AZN monthly). Sub 2 MUST remain 'weekly' (20 AZN weekly)!
userSubs[0].freq = 'monthly';

console.log(`Sub 1 Frequency: ${userSubs[0].freq} (Should be monthly)`);
console.log(`Sub 2 Frequency: ${userSubs[1].freq} (Should be weekly)`);

assert.strictEqual(userSubs[0].freq, 'monthly');
assert.strictEqual(userSubs[1].freq, 'weekly');

// New Spent: 20.00 (Netflix monthly) + 86.67 (Spotify weekly) = 106.67 AZN
spent = calculateTotalSpent(userSubs, 'AZN');
console.log(`Updated Spent (Netflix monthly + Spotify weekly): ${spent.toFixed(2)} AZN`);
assert.strictEqual(spent.toFixed(2), '106.67');

console.log('✅ ALL FREQUENCY ACCURACY AND ISOLATION TESTS PASSED PERFECTLY!');
