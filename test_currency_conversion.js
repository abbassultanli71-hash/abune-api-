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

console.log('--- TEST: INDIVIDUAL SUBSCRIPTION CURRENCY INDEPENDENCE ---');

// Initial Subscriptions: Sub 1 = 20 USD, Sub 2 = 20 AZN
let userSubs = [
  { id: 1, name: 'Netflix', price: 20, currency: 'USD', freq: 'monthly' },
  { id: 2, name: 'Spotify', price: 20, currency: 'AZN', freq: 'monthly' }
];

// 1. Initial Spent in AZN Budget
let spentAzn = calculateTotalSpent(userSubs, 'AZN');
console.log(`Initial Spent (20$ + 20 AZN in AZN Budget): ${spentAzn.toFixed(2)} AZN`);
assert.strictEqual(spentAzn.toFixed(2), '54.00');

// 2. Change ONLY Sub 1 (Netflix) from USD to EUR (20 EUR). Sub 2 MUST remain AZN!
userSubs[0].currency = 'EUR';

console.log(`Sub 1 Currency: ${userSubs[0].currency} (Should be EUR)`);
console.log(`Sub 2 Currency: ${userSubs[1].currency} (Should be AZN)`);

assert.strictEqual(userSubs[0].currency, 'EUR');
assert.strictEqual(userSubs[1].currency, 'AZN');

// 3. New Spent in AZN Budget (20 EUR * 1.85 + 20 AZN = 37 + 20 = 57 AZN)
spentAzn = calculateTotalSpent(userSubs, 'AZN');
console.log(`Updated Spent (20 EUR + 20 AZN in AZN Budget): ${spentAzn.toFixed(2)} AZN`);
assert.strictEqual(spentAzn.toFixed(2), '57.00');

// 4. Change ONLY Sub 2 (Spotify) from AZN to USD (20 USD). Sub 1 remains EUR (20 EUR)!
userSubs[1].currency = 'USD';

console.log(`Sub 1 Currency: ${userSubs[0].currency} (EUR)`);
console.log(`Sub 2 Currency: ${userSubs[1].currency} (USD)`);

assert.strictEqual(userSubs[0].currency, 'EUR');
assert.strictEqual(userSubs[1].currency, 'USD');

// 5. New Spent in AZN Budget (20 EUR * 1.85 + 20 USD * 1.70 = 37 + 34 = 71 AZN)
spentAzn = calculateTotalSpent(userSubs, 'AZN');
console.log(`Updated Spent (20 EUR + 20 USD in AZN Budget): ${spentAzn.toFixed(2)} AZN`);
assert.strictEqual(spentAzn.toFixed(2), '71.00');

console.log('✅ INDIVIDUAL SUBSCRIPTION CURRENCY INDEPENDENCE TEST PASSED PERFECTLY!');
