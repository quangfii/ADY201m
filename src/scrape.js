import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { appendHistory } from "./storage/history.js";
import { readJson, writeJson } from "./utils/fs.js";
import { log } from "./utils/logger.js";
import { scrapeBachHoaXanh } from "./scrapers/bachhoaxanh.js";
import { scrapeWinmart } from "./scrapers/winmart.js";

const SCRAPERS = {
  winmart: scrapeWinmart,
  bachhoaxanh: scrapeBachHoaXanh
};

export async function runScrape() {
  const sources = await readJson(path.resolve("config", "sources.json"));
  const collectedAt = new Date().toISOString();
  const date = collectedAt.slice(0, 10);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "vi-VN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
  });

  const allProducts = [];
  try {
    for (const [supermarket, entries] of Object.entries(sources)) {
      const scraper = SCRAPERS[supermarket];
      if (!scraper) {
        await log("Bo qua sieu thi chua co scraper", { supermarket });
        continue;
      }

      for (const source of entries) {
        const page = await context.newPage();
        try {
          await log("Dang cao du lieu", { supermarket, category: source.category, url: source.url });
          const products = await scraper(page, source, collectedAt);
          allProducts.push(...products);
          await writeJson(
            path.resolve("data", "raw", date, `${supermarket}-${Date.now()}.json`),
            products
          );
          await log("Cao du lieu thanh cong", {
            supermarket,
            category: source.category,
            count: products.length
          });
        } catch (error) {
          await log("Cao du lieu that bai", {
            supermarket,
            category: source.category,
            error: error.message
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (allProducts.length) await appendHistory(allProducts);
  await log("Hoan tat mot lan cao du lieu", { count: allProducts.length });
  return allProducts;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runScrape().catch(async (error) => {
    await log("Loi khong mong doi", { error: error.stack || error.message });
    process.exitCode = 1;
  });
}
