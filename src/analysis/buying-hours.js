import { normalizeText } from '../utils/price.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function sizeKey(row) {
  const match = `${row.size || ''} ${row.name || ''}`.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!match) return normalizeText(row.size || 'unknown');
  const unit = match[2].toLowerCase();
  return Number(match[1].replace(',', '.')) * (unit === 'kg' || unit === 'l' ? 1000 : 1) + (['kg', 'g'].includes(unit) ? 'g' : 'ml');
}

// Compare the same store product and package; never pool different store prices.
// One median per date/hour prevents retries from receiving extra weight.
export function analyzeBuyingHours(rows, { now = new Date(), windowDays = 30, minDays = 3 } = {}) {
  const nowMs = new Date(now).getTime();
  const groups = new Map();
  for (const row of rows) {
    const timestamp = Date.parse(row.collected_at);
    const price = Number(row.actual_price);
    if (!row.name || !row.supermarket || !Number.isFinite(timestamp) || timestamp > nowMs || timestamp < nowMs - windowDays * DAY || !Number.isFinite(price) || price <= 0) continue;
    const identity = row.product_id || row.product_url || normalizeText(row.name);
    const id = JSON.stringify([row.supermarket, identity, sizeKey(row)]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ ...row, timestamp, price });
  }
  const products = [];
  for (const [id, observations] of groups) {
    const latest = observations.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
    const samples = new Map();
    for (const row of observations) {
      // Vietnam is UTC+7 and has no daylight saving time.
      const local = new Date(row.timestamp + 7 * HOUR);
      const date = local.toISOString().slice(0, 10);
      const hour = local.getUTCHours();
      const key = `${date}|${hour}`;
      if (!samples.has(key)) samples.set(key, { date, hour, prices: [] });
      samples.get(key).prices.push(row.price);
    }
    const byHour = new Map();
    for (const sample of samples.values()) {
      if (!byHour.has(sample.hour)) byHour.set(sample.hour, []);
      byHour.get(sample.hour).push({ date: sample.date, price: median(sample.prices), observations: sample.prices.length });
    }
    const hours = [...byHour].sort((a, b) => a[0] - b[0]).map(([hour, items]) => ({
      hour, days: items.length, observations: items.reduce((sum, item) => sum + item.observations, 0),
      median_price: Math.round(median(items.map(item => item.price))),
      min_price: Math.min(...items.map(item => item.price)), max_price: Math.max(...items.map(item => item.price))
    }));
    const eligible = hours.filter(hour => hour.days >= minDays);
    // All ranked hours must be observed on the same dates, avoiding a price change
    // between dates being incorrectly attributed to the time of day.
    const rankedHours = eligible.length >= 2 ? eligible : hours;
    const commonDates = rankedHours.length >= 2 ? byHour.get(rankedHours[0].hour).map(item => item.date).filter(date => rankedHours.every(hour => byHour.get(hour.hour).some(item => item.date === date))) : [];
    const common = new Set(commonDates);
    const baselines = new Map(commonDates.map(date => [date, median(rankedHours.map(hour => byHour.get(hour.hour).find(item => item.date === date).price))]));
    const ranking = commonDates.length ? rankedHours.map(hour => {
      const items = byHour.get(hour.hour).filter(item => common.has(item.date));
      return {hour: hour.hour, median_price: Math.round(median(items.map(item => item.price))), relative_price: median(items.map(item => item.price / baselines.get(item.date)))};
    }).sort((a, b) => a.relative_price - b.relative_price || a.hour - b.hour) : [];
    for (const hour of hours) hour.comparison_median_price = ranking.find(item => item.hour === hour.hour)?.median_price ?? null;
    const enough = eligible.length >= 2 && commonDates.length >= minDays;
    const best = ranking[0];
    const worst = ranking.at(-1);
    const spread = best ? (worst.relative_price - best.relative_price) / worst.relative_price : 0;
    const status = !best ? 'insufficient' : spread < 0.005 ? 'no_hour_advantage' : enough ? 'recommended' : 'provisional';
    const bestHours = best && status !== 'no_hour_advantage' ? ranking.filter(item => Math.abs(item.relative_price - best.relative_price) < 1e-9).map(item => item.hour) : [];
    products.push({
      id, supermarket: latest.supermarket, product_id: latest.product_id || '', name: latest.name,
      category: latest.category || '', size: latest.size || '', product_url: latest.product_url || '',
      status, sufficient_history: enough, stale: nowMs - latest.timestamp > 48 * HOUR,
      observed_days: new Set([...samples.values()].map(item => item.date)).size,
      observed_hours: hours.length, common_days: commonDates.length,
      latest_collected_at: latest.collected_at, latest_price: latest.price,
      best_hours: bestHours, typical_best_price: bestHours.length ? best.median_price : null,
      relative_saving_percent: bestHours.length ? Math.round(spread * 10000) / 100 : null,
      current_price_is_good: status === 'recommended' && nowMs - latest.timestamp <= 90 * 60000 ? latest.price <= best.median_price : null,
      hours
    });
  }
  const rank = {recommended: 0, provisional: 1, no_hour_advantage: 2, insufficient: 3};
  products.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'vi'));
  return {
    timezone: 'Asia/Ho_Chi_Minh', window_days: windowDays, minimum_common_days: minDays,
    generated_at: new Date(nowMs).toISOString(),
    summary: {products: products.length, recommended: products.filter(p => p.status === 'recommended' && !p.stale).length, provisional: products.filter(p => p.status === 'provisional').length, insufficient: products.filter(p => p.status === 'insufficient').length, no_hour_advantage: products.filter(p => p.status === 'no_hour_advantage').length},
    products
  };
}
