import { inferBrand, inferSize, parsePrice, productKey } from "../utils/price.js";

export function normalizeProduct(raw, context) {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  const size = raw.size || inferSize(name);
  const originalPrice = parsePrice(raw.original_price);
  const salePrice = parsePrice(raw.sale_price);
  const actualPrice = parsePrice(raw.actual_price ?? raw.sale_price ?? raw.original_price);

  return {
    collected_at: context.collectedAt,
    supermarket: context.supermarket,
    product_id: raw.product_id ?? "",
    name,
    brand: raw.brand ?? inferBrand(name),
    category: context.category,
    size,
    original_price: originalPrice ?? "",
    sale_price: salePrice ?? "",
    actual_price: actualPrice ?? "",
    discount_text: raw.discount_text ?? "",
    image_url: raw.image_url ?? raw.image ?? "",
    product_url: raw.product_url ?? "",
    source_url: context.sourceUrl,
    match_key: productKey(name, size)
  };
}

export async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 700;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
}

export async function collectJsonLdProducts(page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const values = [];

    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
      if (String(type ?? "").toLowerCase().includes("product")) values.push(node);
      Object.values(node).forEach(visit);
    }

    for (const script of scripts) {
      try {
        visit(JSON.parse(script.textContent));
      } catch {
        // Ignore malformed structured data.
      }
    }

    return values.map((item) => ({
      name: item.name,
      brand: typeof item.brand === "string" ? item.brand : item.brand?.name,
      actual_price: item.offers?.price ?? item.offers?.lowPrice,
      product_url: item.url
    }));
  });
}
