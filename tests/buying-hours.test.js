import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBuyingHours } from '../src/analysis/buying-hours.js';
const now = new Date('2026-10-11T12:00:00Z');
function row(date, hour, price, overrides = {}) {
  return {supermarket: 'winmart', product_id: 'milk', name: 'Sữa ABC', size: '1l', actual_price: price, collected_at: `${date}T${String(hour).padStart(2, '0')}:00:00+07:00`, ...overrides};
}
test('recommends the cheaper observed Vietnam hour on three common days', () => {
  const rows = ['2026-10-09', '2026-10-10', '2026-10-11'].flatMap(date => [row(date, 9, 30000), row(date, 15, 25000)]);
  const report = analyzeBuyingHours(rows, {now});
  const product = report.products[0];
  assert.equal(product.status, 'recommended');
  assert.deepEqual(product.best_hours, [15]);
  assert.equal(product.common_days, 3);
  assert.equal(product.typical_best_price, 25000);
  assert.equal(product.relative_saving_percent, 16.67);
});
test('does not pretend a single hour or a single day is sufficient', () => {
  assert.equal(analyzeBuyingHours([row('2026-10-11', 9, 30000)], {now}).products[0].status, 'insufficient');
  const product = analyzeBuyingHours([row('2026-10-11', 9, 30000), row('2026-10-11', 15, 25000)], {now}).products[0];
  assert.equal(product.status, 'provisional');
  assert.equal(product.sufficient_history, false);
});
test('keeps stores, product IDs and package sizes separate', () => {
  const rows = [row('2026-10-11', 9, 30000), row('2026-10-11', 15, 25000, {supermarket: 'bachhoaxanh'}), row('2026-10-11', 15, 25000, {product_id:'other'}), row('2026-10-11', 15, 25000, {size:'500ml'})];
  assert.equal(analyzeBuyingHours(rows, {now}).products.length, 4);
  assert.ok(analyzeBuyingHours(rows, {now}).products.every(product => product.status === 'insufficient'));
});
test('does not confuse changing prices across dates with a time of day effect', () => {
  const differentDates = [row('2026-10-09', 9, 30000), row('2026-10-10', 15, 25000)];
  assert.equal(analyzeBuyingHours(differentDates, {now}).products[0].status, 'insufficient');
  const trend = ['2026-10-09', '2026-10-10', '2026-10-11'].flatMap((date, i) => [row(date, 9, 30000 - i * 5000), row(date, 15, 30000 - i * 5000)]);
  const product = analyzeBuyingHours(trend, {now}).products[0];
  assert.equal(product.status, 'no_hour_advantage');
  assert.deepEqual(product.best_hours, []);
});
test('uses local date at midnight and flags stale history', () => {
  const product = analyzeBuyingHours([{...row('2026-10-01', 0, 30000), collected_at:'2026-09-30T17:30:00Z'}], {now}).products[0];
  assert.equal(product.hours[0].hour, 0);
  assert.equal(product.stale, true);
  assert.equal(product.current_price_is_good, null);
});
test('retries receive one day weight and invalid or old observations are excluded', () => {
  const rows = ['2026-10-09', '2026-10-10', '2026-10-11'].flatMap(date => [row(date, 9, 30000), row(date, 15, 25000)]);
  rows.push(...Array.from({length:10}, () => row('2026-10-11',9,30000)), row('2026-08-01',1,1000), row('2026-10-11',1,0), {...row('2026-10-11',1,5000), collected_at:'invalid'}, row('2026-10-12',1,1000));
  const product = analyzeBuyingHours(rows, {now}).products[0];
  assert.equal(product.hours.length, 2);
  assert.equal(product.hours[0].days, 3);
  assert.equal(product.hours[0].observations, 13);
  assert.deepEqual(product.best_hours, [15]);
});
