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
  if (from === to) return Number(mebleq);

  const fromRate = VALYUTA_RATES_AZN[from] || 1.0;
  const toRate = VALYUTA_RATES_AZN[to] || 1.0;

  return ((Number(mebleq) || 0) * fromRate) / toRate;
}

function toMonthlyAmount(qiymet, odenisTezliyi) {
  const amount = Number(qiymet) || 0;
  const tezlik = String(odenisTezliyi || 'monthly').toLowerCase();
  switch (tezlik) {
    case 'weekly':
      return amount * 52 / 12;
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

console.log('--- RUNNING DIRECT AZN MULTI-CURRENCY TESTS ---');

// Test 1: 70 USD monthly sub -> Budget in AZN
const test1 = convertCurrency(toMonthlyAmount(70, 'monthly'), 'USD', 'AZN');
console.log(`Test 1 (70 USD -> AZN): ${test1.toFixed(2)} AZN`);
assert.strictEqual(test1.toFixed(2), '119.00');

// Test 2: 70 AZN monthly sub -> Budget in USD
const test2 = convertCurrency(toMonthlyAmount(70, 'monthly'), 'AZN', 'USD');
console.log(`Test 2 (70 AZN -> USD): ${test2.toFixed(2)} USD`);
assert.strictEqual(test2.toFixed(2), '41.18');

// Test 3: 50 EUR monthly sub -> Budget in AZN (Direct 1 EUR = 1.85 AZN)
const test3 = convertCurrency(toMonthlyAmount(50, 'monthly'), 'EUR', 'AZN');
console.log(`Test 3 (50 EUR -> AZN): ${test3.toFixed(2)} AZN`);
assert.strictEqual(test3.toFixed(2), '92.50');

// Test 4: Budget limit auto-conversion 500 AZN -> USD
const test4 = convertCurrency(500, 'AZN', 'USD');
console.log(`Test 4 (500 AZN limit -> USD limit): ${test4.toFixed(2)} USD`);
assert.strictEqual(test4.toFixed(2), '294.12');

// Test 5: Budget limit auto-conversion 500 AZN -> EUR
const test5 = convertCurrency(500, 'AZN', 'EUR');
console.log(`Test 5 (500 AZN limit -> EUR limit): ${test5.toFixed(2)} EUR`);
assert.strictEqual(test5.toFixed(2), '270.27');

console.log('✅ ALL DIRECT MANAT CONVERSION TESTS PASSED SUCCESSFULLY!');
