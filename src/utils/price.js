export function parsePrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/[^\d,.]/g, "")
    .replace(/[,.](?=\d{3}\b)/g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function inferSize(name) {
  const match = String(name ?? "").match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gram|ml|l|lit|chai|goi|hop|vi|khay|tui)\b/i);
  return match ? match[0].replace(",", ".") : "";
}

export function inferBrand(name) {
  const clean = String(name ?? "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return "";
  return /^[A-Z0-9]+$/.test(parts[0]) ? parts[0] : "";
}

export function productKey(name, size = "") {
  return normalizeText(`${name} ${size}`);
}
