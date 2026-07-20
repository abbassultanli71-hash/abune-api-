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
      return (amount * 52) / 12;
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

console.log('--- RUNNING USER SPECIFIC EXACT TEST CASES ---');

// USER EXAMPLE: 20$ + 20 manat when budget currency is AZN
// 20$ * 1.70 + 20 AZN = 34 + 20 = 54 AZN
const userExampleSubs = [
  { price: 20, currency: 'USD', freq: 'monthly' },
  { price: 20, currency: 'AZN', freq: 'monthly' }
];

const spentInAzn = calculateTotalSpent(userExampleSubs, 'AZN');
console.log(`User Example (20$ + 20 AZN -> Budget AZN): ${spentInAzn.toFixed(2)} AZN`);
assert.strictEqual(spentInAzn.toFixed(2), '54.00');

// REVERSE EXAMPLE: 20$ + 20 manat when budget currency is USD
// 20 USD + (20 AZN / 1.70) = 20 + 11.7647 = 31.76 USD
const spentInUsd = calculateTotalSpent(userExampleSubs, 'USD');
console.log(`User Example (20$ + 20 AZN -> Budget USD): ${spentInUsd.toFixed(2)} USD`);
assert.strictEqual(spentInUsd.toFixed(2), '31.76');

// EURO EXAMPLE: 20$ + 20 AZN + 10 EUR when budget currency is AZN
// 20*1.70 + 20 + 10*1.85 = 34 + 20 + 18.50 = 72.50 AZN
const tripleSubs = [
  { price: 20, currency: 'USD', freq: 'monthly' },
  { price: 20, currency: 'AZN', freq: 'monthly' },
  { price: 10, currency: 'EUR', freq: 'monthly' }
];
const spentTripleAzn = calculateTotalSpent(tripleSubs, 'AZN');
console.log(`Triple Example (20$ + 20 AZN + 10 EUR -> Budget AZN): ${spentTripleAzn.toFixed(2)} AZN`);
assert.strictEqual(spentTripleAzn.toFixed(2), '72.50');

console.log('✅ ALL EXACT CALCULATION TESTS PASSED WITH 100% ACCURACY!');
