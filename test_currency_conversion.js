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

// Frequency is strictly ignored in calculations as explicitly requested by user
function toMonthlyAmount(qiymet, odenisTezliyi) {
  return Number(qiymet) || 0;
}

function calculateTotalSpent(subs, targetCurrency) {
  let total = 0;
  subs.forEach(s => {
    // Just prices directly without frequency multiplier
    const rawPrice = Number(s.price) || 0;
    total += convertCurrency(rawPrice, s.currency, targetCurrency);
  });
  return Math.round(total * 100) / 100;
}

console.log('--- TEST: RAW PRICE SUMMATION (FREQUENCY IGNORED IN MATH) ---');

// Sub 1: 20 USD (weekly) -> 20 * 1.70 = 34 AZN (weekly multiplier ignored!)
// Sub 2: 20 AZN (monthly) -> 20 AZN
// Sub 3: 50 EUR (yearly) -> 50 * 1.85 = 92.50 AZN (yearly divider ignored!)
const testSubs = [
  { price: 20, currency: 'USD', freq: 'weekly' },
  { price: 20, currency: 'AZN', freq: 'monthly' },
  { price: 50, currency: 'EUR', freq: 'yearly' }
];

const totalInAzn = calculateTotalSpent(testSubs, 'AZN');
console.log(`Raw Price Sum in AZN Budget: ${totalInAzn.toFixed(2)} AZN`);
// 34 + 20 + 92.50 = 146.50 AZN
assert.strictEqual(totalInAzn.toFixed(2), '146.50');

const userExampleSubs = [
  { price: 20, currency: 'USD', freq: 'weekly' },
  { price: 20, currency: 'AZN', freq: 'weekly' }
];
const userTotalInAzn = calculateTotalSpent(userExampleSubs, 'AZN');
console.log(`User Example (20$ weekly + 20 AZN weekly in AZN Budget): ${userTotalInAzn.toFixed(2)} AZN`);
// 20*1.70 + 20 = 34 + 20 = 54.00 AZN
assert.strictEqual(userTotalInAzn.toFixed(2), '54.00');

console.log('✅ FREQUENCY-FREE RAW PRICE SUMMATION TEST PASSED PERFECTLY!');
