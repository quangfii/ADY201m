import path from "node:path";
import { chromium } from "playwright";
import { scrapeBachHoaXanh } from "./scrapers/bachhoaxanh.js";
import { scrapeWinmart } from "./scrapers/winmart.js";
import { appendHistory, readHistory } from "./storage/history.js";
import { writeJson, readJson } from "./utils/fs.js";
import { log } from "./utils/logger.js";

const MAX_CATEGORIES = Number(process.env.MAX_CATEGORIES || 0);
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.SCRAPE_CONCURRENCY || 3)));

async function discoverWinmart(page) {
  await page.goto("https://winmart.vn/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll('a[href*="--c"]')]
      .map((a) => ({ category: (a.textContent || "").trim(), url: a.href }))
      .filter((x) => x.category && /--c\d+/.test(x.url) && !seen.has(x.url) && seen.add(x.url));
  });
}

async function discoverBachHoaXanh() {
  const response = await fetch("https://www.bachhoaxanh.com/sitemapnew/sitemap-cate");
  if (!response.ok) throw new Error(`Sitemap BHX tra ve ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => ({
    category: decodeURIComponent(new URL(match[1]).pathname.slice(1)).replaceAll("-", " "),
    url: match[1]
  }));
}

async function worker(context, queue, collectedAt, output) {
  const page = await context.newPage();
  while (queue.length) {
    const source = queue.shift();
    if (!source) break;
    try {
      const scraper = source.supermarket === "winmart" ? scrapeWinmart : scrapeBachHoaXanh;
      const products = await scraper(page, source, collectedAt);
      output.push(...products);
      await log("Da cao danh muc", { supermarket: source.supermarket, category: source.category, count: products.length });
    } catch (error) {
      await log("Loi danh muc", { supermarket: source.supermarket, category: source.category, error: error.message });
    }
  }
  await page.close();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "vi-VN" });
try {
  const discoveryPage = await context.newPage();
  const results = await Promise.allSettled([discoverWinmart(discoveryPage), discoverBachHoaXanh()]);
  const configured = await readJson(path.resolve('config', 'sources.json'), {});
  const cached = await readJson(path.resolve('data', 'discovered_sources.json'), {});
  const previous = await readHistory();
  const categories = {};
  for (const [index, store] of ['winmart', 'bachhoaxanh'].entries()) {
    const result = results[index];
    const historical = [...new Map(previous.filter(row => row.supermarket === store && row.source_url).map(row => [row.source_url, {category: row.category, url: row.source_url}])).values()];
    categories[store] = result.status === 'fulfilled' && result.value.length ? result.value : historical.length ? historical : cached[store] || configured[store] || [];
    if (result.status === 'rejected') await log('Loi phat hien danh muc, dung danh muc du phong', {supermarket: store, error: result.reason.message, categories: categories[store].length});
  }
  await writeJson(path.resolve('data', 'discovered_sources.json'), categories);
  const {winmart, bachhoaxanh} = categories;
  await discoveryPage.close();
  let sources = [
    ...winmart.map((item) => ({ ...item, supermarket: "winmart" })),
    ...bachhoaxanh.map((item) => ({ ...item, supermarket: "bachhoaxanh" }))
  ];
  if (MAX_CATEGORIES > 0) sources = sources.slice(0, MAX_CATEGORIES);

  const collectedAt = new Date().toISOString();
  const products = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(context, sources, collectedAt, products)));

  const unique = new Map();
  for (const product of products) {
    const key = `${product.supermarket}|${product.product_id || product.product_url}`;
    if (product.name && product.actual_price && !unique.has(key)) unique.set(key, product);
  }
  const result = [...unique.values()];
  if (!result.length) throw new Error('Khong thu duoc san pham; khong tao bao cao moi tu du lieu cu.');
  if (result.length) await appendHistory(result);
  await writeJson(path.resolve("data", "raw", collectedAt.slice(0, 10), `all-${Date.now()}.json`), result);
  await log("Hoan tat cao toan bo danh muc", { count: result.length });
  console.log(`Da thu thap ${result.length} san pham duy nhat.`);
} finally {
  await browser.close();
}
