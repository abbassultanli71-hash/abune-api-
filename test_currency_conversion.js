const assert = require('assert');

// Mock rates & helper functions identical to server.js
const VALYUTA_MEZARBELERI_TO_USD = {
  USD: 1.0,
  AZN: 1.70,
  EUR: 0.92
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

  const fromRate = VALYUTA_MEZARBELERI_TO_USD[from] || 1.0;
  const toRate = VALYUTA_MEZARBELERI_TO_USD[to] || 1.0;

  return Number(mebleq) * (toRate / fromRate);
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

console.log('--- RUNNING MULTI-CURRENCY BUDGET TESTS ---');

// Test 1: 70 USD monthly sub -> Budget in AZN
const test1 = convertCurrency(toMonthlyAmount(70, 'monthly'), 'USD', 'AZN');
console.log(`Test 1 (70 USD -> AZN): ${test1.toFixed(2)} AZN`);
assert.strictEqual(test1.toFixed(2), '119.00');

// Test 2: 70 AZN monthly sub -> Budget in USD
const test2 = convertCurrency(toMonthlyAmount(70, 'monthly'), 'AZN', 'USD');
console.log(`Test 2 (70 AZN -> USD): ${test2.toFixed(2)} USD`);
assert.strictEqual(test2.toFixed(2), '41.18');

// Test 3: 50 EUR monthly sub -> Budget in AZN
const test3 = convertCurrency(toMonthlyAmount(50, 'monthly'), 'EUR', 'AZN');
console.log(`Test 3 (50 EUR -> AZN): ${test3.toFixed(2)} AZN`);
assert.strictEqual(test3.toFixed(2), '92.39');

// Test 4: 120 USD yearly sub -> Budget in AZN
const test4 = convertCurrency(toMonthlyAmount(120, 'yearly'), 'USD', 'AZN');
console.log(`Test 4 (120 USD/year -> AZN/month): ${test4.toFixed(2)} AZN`);
assert.strictEqual(test4.toFixed(2), '17.00');

console.log('✅ ALL MULTI-CURRENCY CONVERSION TESTS PASSED SUCCESSFULLY!');
