import path from "node:path";
import { readHistory } from "./storage/history.js";
import { writeJson } from "./utils/fs.js";
import { normalizeText } from "./utils/price.js";

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function valid(row) {
  const name = String(row.name || "").trim();
  return name && numeric(row.actual_price) >= 1000 && !/^(them vao gio|mua|trang chu|hom nay an gi|[+-]?\d+%)$/i.test(normalizeText(name));
}

function extractSize(row) {
  const candidates = [row.size, row.name, decodeURIComponent(row.product_url || "")];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|quả)\b/i);
    if (match) return `${match[1].replace(",", ".")}${match[2].toLowerCase()}`;
  }
  return row.size || "";
}

function quantityInBaseUnit(size, name) {
  const text = `${size || ""} ${name || ""}`;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  return unit === "kg" || unit === "l" ? amount * 1000 : amount;
}

const rows = (await readHistory()).filter(valid);
const latest = new Map();
for (const row of rows) {
  const identity = `${row.supermarket}|${row.product_id || row.product_url || row.match_key}`;
  const previous = latest.get(identity);
  if (!previous || row.collected_at > previous.collected_at) latest.set(identity, row);
}

const products = [...latest.values()].map((row) => {
  const price = numeric(row.actual_price);
  const size = extractSize(row);
  const baseQuantity = quantityInBaseUnit(size, row.name);
  return {
    id: `${row.supermarket}-${row.product_id || normalizeText(row.product_url || row.name)}`,
    supermarket: row.supermarket,
    name: row.name,
    normalized_name: normalizeText(row.name),
    brand: row.brand || "",
    category: row.category || "",
    size,
    original_price: numeric(row.original_price),
    sale_price: numeric(row.sale_price),
    actual_price: price,
    unit_price: baseQuantity ? Math.round((price / baseQuantity) * 1000) : null,
    unit_label: baseQuantity ? (/ml|\bl\b/i.test(`${row.size} ${row.name}`) ? "1 lít" : "1 kg") : "",
    discount_text: row.discount_text || "",
    image_url: row.image_url || "",
    product_url: row.product_url || "",
    collected_at: row.collected_at
  };
});

products.sort((a, b) => a.name.localeCompare(b.name, "vi"));
await writeJson(path.resolve("public", "catalog.json"), {
  generated_at: new Date().toISOString(),
  count: products.length,
  products
});
console.log(`Da tao danh muc ${products.length} san pham.`);
