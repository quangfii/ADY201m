import { autoScroll, collectJsonLdProducts, normalizeProduct } from "./common.js";

export async function scrapeWinmart(page, source, collectedAt) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForSelector(".product-card", { timeout: 30000 }).catch(() => {});
  await autoScroll(page).catch(() => {});

  const structured = await collectJsonLdProducts(page);
  const domProducts = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".product-card")];

    return cards
      .map((card) => {
        const text = card.innerText || "";
        const prices = [...text.matchAll(/(?:\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:₫|đ|VND)(?!\p{L})/giu)].map((m) => m[0]);
        const link = card.querySelector('a[href*="/products/"]')?.href || "";
        const imageAlt = card.querySelector("img.product-image[alt]")?.alt || "";
        const imageUrl = card.querySelector("img.product-image")?.src || "";
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const name = imageAlt.trim();
        const size = text.match(/\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/i)?.[0] ||
          lines.find((line) => /^(?:khay|goi|hop|chai|tui)$/i.test(line)) || "";

        return {
          name,
          size,
          product_id: link.match(/--s(\d+)/)?.[1] || "",
          original_price: prices.length > 1 ? prices[1] : "",
          sale_price: prices[0] || "",
          actual_price: prices[0] || "",
          discount_text: lines.find((line) => /%|giam|khuyen mai|sale/i.test(line)) || "",
          image_url: imageUrl,
          product_url: link
        };
      })
      .filter((item) => item.name && item.actual_price);
  });

  const merged = domProducts.length ? domProducts : structured;
  const seen = new Set();
  return merged
    .map((raw) =>
      normalizeProduct(raw, {
        collectedAt,
        supermarket: "winmart",
        category: source.category,
        sourceUrl: source.url
      })
    )
    .filter((product) => {
      const key = `${product.name}|${product.actual_price}|${product.product_url}`;
      if (!product.name || !product.actual_price || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
