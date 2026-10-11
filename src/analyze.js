import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHistory, writeCsv } from "./storage/history.js";
import { readJson, writeJson } from "./utils/fs.js";
import { normalizeText } from "./utils/price.js";

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidObservation(row) {
  const name = String(row.name || "").trim();
  const price = toNumber(row.actual_price);
  if (!name || price === null || price <= 0) return false;
  if (/^(?:them vao gio|mua|trang chu)$/i.test(normalizeText(name))) return false;
  if (/^(?:\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:₫|d|đ|vnd)$/i.test(name)) return false;
  if (/^[+-]?\d+%$/.test(name)) return false;
  return true;
}

function comparisonKey(row) {
  const text = [row.size, row.name, row.product_url].join(' ');
  const size = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!size) return 'unverified|' + row.supermarket + '|' + (row.product_id || row.product_url || row.name);
  const unit = size[2].toLowerCase();
  const quantity = Number(size[1].replace(',', '.')) * (unit === 'kg' || unit === 'l' ? 1000 : 1);
  const name = normalizeText(row.name).replace(/\b\d+(?: \d+)?\s*(kg|g|ml|l)\b/g, '').trim();
  return name + '|' + quantity + (unit === 'kg' || unit === 'g' ? 'g' : 'ml');
}

function latestRows(rows) {
  const byStoreProduct = new Map();
  for (const row of rows) {
    const key = `${row.supermarket}|${row.product_id || row.product_url || row.match_key || normalizeText(row.name)}`;
    const previous = byStoreProduct.get(key);
    if (!previous || row.collected_at > previous.collected_at) byStoreProduct.set(key, row);
  }
  return [...byStoreProduct.values()];
}

export function compareProducts(rows) {
  const groups = new Map();
  for (const row of latestRows(rows)) {
    const key = comparisonKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([matchKey, items]) => {
      const winmart = items.filter(item => item.supermarket === 'winmart').sort((a,b) => Number(a.actual_price)-Number(b.actual_price))[0];
      const bachhoaxanh = items.filter(item => item.supermarket === 'bachhoaxanh').sort((a,b) => Number(a.actual_price)-Number(b.actual_price))[0];
      const winmartPrice = toNumber(winmart?.actual_price);
      const bachhoaxanhPrice = toNumber(bachhoaxanh?.actual_price);
      const aligned = winmart && bachhoaxanh && Math.abs(Date.parse(winmart.collected_at) - Date.parse(bachhoaxanh.collected_at)) <= 90 * 60000;
      const diff =
        aligned && winmartPrice !== null && bachhoaxanhPrice !== null ? bachhoaxanhPrice - winmartPrice : null;
      const cheaper =
        diff === null ? "not_comparable" : diff > 0 ? "winmart" : diff < 0 ? "bachhoaxanh" : "same";

      return {
        match_key: matchKey,
        sample_name: winmart?.name || bachhoaxanh?.name || "",
        category: winmart?.category || bachhoaxanh?.category || "",
        winmart_price: winmartPrice ?? "",
        bachhoaxanh_price: bachhoaxanhPrice ?? "",
        difference_bhx_minus_winmart: diff ?? "",
        absolute_difference: diff === null ? "" : Math.abs(diff),
        cheaper_at: cheaper,
        winmart_url: winmart?.product_url || "",
        bachhoaxanh_url: bachhoaxanh?.product_url || ""
        ,winmart_collected_at: winmart?.collected_at || '', bachhoaxanh_collected_at: bachhoaxanh?.collected_at || ''
      };
    })
    .sort((a, b) => Number(b.absolute_difference || 0) - Number(a.absolute_difference || 0));
}

function summarizeByCategory(comparisons) {
  const groups = new Map();
  for (const row of comparisons) {
    if (row.absolute_difference === "") continue;
    const key = row.category || "Khong ro";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Number(row.absolute_difference));
  }

  return [...groups.entries()]
    .map(([category, diffs]) => ({
      category,
      comparable_products: diffs.length,
      min_difference: Math.min(...diffs),
      max_difference: Math.max(...diffs),
      avg_difference: Math.round(diffs.reduce((sum, value) => sum + value, 0) / diffs.length)
    }))
    .sort((a, b) => b.avg_difference - a.avg_difference);
}

function priceVolatility(rows) {
  const groups = new Map();
  for (const row of rows) {
    const price = toNumber(row.actual_price);
    if (price === null) continue;
    const key = `${row.supermarket}|${row.product_id || row.product_url || row.match_key || normalizeText(row.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, price });
  }

  return [...groups.values()]
    .map((items) => {
      const prices = items.map((item) => item.price);
      const first = items.toSorted((a, b) => a.collected_at.localeCompare(b.collected_at))[0];
      return {
        supermarket: first.supermarket,
        match_key: first.match_key,
        name: first.name,
        category: first.category,
        observations: prices.length,
        min_price: Math.min(...prices),
        max_price: Math.max(...prices),
        avg_price: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
        price_range: Math.max(...prices) - Math.min(...prices)
      };
    })
    .sort((a, b) => b.price_range - a.price_range);
}

function basketComparison(comparisons, basket) {
  return basket.map((item) => {
    const wanted = normalizeText(item.name);
    const matched = comparisons.find((row) => row.match_key.includes(wanted) || wanted.includes(row.match_key));
    const quantity = Number(item.quantity || 1);
    const winmart = toNumber(matched?.winmart_price);
    const bachhoaxanh = toNumber(matched?.bachhoaxanh_price);
    return {
      basket_item: item.name,
      matched_product: matched?.sample_name || "",
      quantity,
      winmart_total: winmart === null ? "" : winmart * quantity,
      bachhoaxanh_total: bachhoaxanh === null ? "" : bachhoaxanh * quantity,
      cheaper_at: matched?.cheaper_at || "not_found"
    };
  });
}

export async function runAnalysis() {
  const rows = await readHistory();
  const validRows = rows.filter(isValidObservation);
  const comparisons = compareProducts(validRows);
  const categorySummary = summarizeByCategory(comparisons);
  const volatility = priceVolatility(validRows);
  const basket = await readJson(path.resolve("config", "basket.json"), []);
  const basketRows = basketComparison(comparisons, basket);

  await writeCsv(path.resolve("reports", "product_price_comparison.csv"), comparisons);
  await writeCsv(path.resolve("reports", "category_price_summary.csv"), categorySummary);
  await writeCsv(path.resolve("reports", "basket_comparison.csv"), basketRows);
  await writeCsv(path.resolve("reports", "price_volatility.csv"), volatility);

  const comparable = comparisons.filter((row) => row.absolute_difference !== "");
  const summary = {
    generated_at: new Date().toISOString(),
    total_observations: rows.length,
    valid_observations: validRows.length,
    rejected_observations: rows.length - validRows.length,
    comparable_products: comparable.length,
    largest_difference: comparable[0] || null,
    category_with_highest_avg_difference: categorySummary[0] || null,
    most_volatile_product: volatility[0] || null,
    diagnostic_notes: [
      "Chenh lech co the den tu khuyen mai, don vi dong goi, thuong hieu, khu vuc cua hang va thoi diem thu thap.",
      "Can thu thap nhieu moc gio moi du de ket luan xu huong tang/giam va du bao."
    ]
  };
  await writeJson(path.resolve("reports", "summary.json"), summary);
  const categoryPrices = [...new Set(validRows.map(row => row.category))].map(category => {
    const items = latestRows(validRows).filter(row => row.category === category);
    const result = {category};
    for (const store of ['winmart', 'bachhoaxanh']) {
      const prices = items.filter(row => row.supermarket === store).map(row => Number(row.actual_price));
      result[store] = prices.length ? Math.round(prices.reduce((a,b) => a+b,0)/prices.length) : null;
      result[`${store}_count`] = prices.length;
    }
    return result;
  });
  await writeCsv(path.resolve('reports', 'category_prices.csv'), categoryPrices);
  await writeJson(path.resolve('public', 'analytics.json'), {
    summary, comparisons, categories: categoryPrices, volatility, basket: basketRows,
    recommendations: comparable.filter(row => row.cheaper_at !== 'same'),
    history: validRows.map(row => ({collected_at: row.collected_at, supermarket: row.supermarket, name: row.name, match_key: comparisonKey(row), actual_price: Number(row.actual_price)}))
  });
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runAnalysis().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
