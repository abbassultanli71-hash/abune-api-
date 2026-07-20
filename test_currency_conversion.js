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

// Frequency is completely ignored in math calculation
function toMonthlyAmount(qiymet, odenisTezliyi) {
  return Number(qiymet) || 0;
}

function calculateTotalSpent(subs, targetCurrency) {
  let total = 0;
  subs.forEach(s => {
    // Take nominal price directly, ignore frequency multiplier
    const rawPrice = Number(s.price) || 0;
    total += convertCurrency(rawPrice, s.currency, targetCurrency);
  });
  return Math.round(total * 100) / 100;
}

console.log('--- USER EXACT EXAMPLE: 4 SUBS (2 WEEKLY, 2 MONTHLY) OF 20 MANAT ---');

// 4 subscriptions: 2 weekly, 2 monthly, 20 AZN each
// Formula MUST be: 20 + 20 + 20 + 20 = 80 AZN (NO 20*4 MULTIPLIER!)
const fourSubs = [
  { price: 20, currency: 'AZN', freq: 'weekly' },
  { price: 20, currency: 'AZN', freq: 'weekly' },
  { price: 20, currency: 'AZN', freq: 'monthly' },
  { price: 20, currency: 'AZN', freq: 'monthly' }
];

const totalFourSubs = calculateTotalSpent(fourSubs, 'AZN');
console.log(`4 Subs Sum (2 weekly, 2 monthly @ 20 AZN): ${totalFourSubs.toFixed(2)} AZN`);
// 20 + 20 + 20 + 20 = 80.00 AZN
assert.strictEqual(totalFourSubs.toFixed(2), '80.00');

console.log('--- USER MULTI-CURRENCY RAW SUMMATION EXAMPLE ---');

// 2 weekly (20$ & 20 AZN), 2 monthly (20$ & 20 AZN) in AZN budget:
// 20$*1.70 + 20 + 20$*1.70 + 20 = 34 + 20 + 34 + 20 = 108.00 AZN
const multiCurrSubs = [
  { price: 20, currency: 'USD', freq: 'weekly' },
  { price: 20, currency: 'AZN', freq: 'weekly' },
  { price: 20, currency: 'USD', freq: 'monthly' },
  { price: 20, currency: 'AZN', freq: 'monthly' }
];

const totalMultiCurr = calculateTotalSpent(multiCurrSubs, 'AZN');
console.log(`Multi-currency 4 Subs Sum in AZN Budget: ${totalMultiCurr.toFixed(2)} AZN`);
assert.strictEqual(totalMultiCurr.toFixed(2), '108.00');

console.log('✅ ALL EXACT USER DEMANDS PASSED WITH 100% ACCURACY!');
