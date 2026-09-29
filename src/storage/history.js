import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists } from "../utils/fs.js";

export const HISTORY_PATH = path.resolve("data", "processed", "price_history.csv");

export const HISTORY_COLUMNS = [
  "collected_at",
  "supermarket",
  "product_id",
  "name",
  "brand",
  "category",
  "size",
  "original_price",
  "sale_price",
  "actual_price",
  "discount_text",
  "image_url",
  "product_url",
  "source_url",
  "match_key"
];

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function stringifyRows(columns, rows, includeHeader) {
  const lines = [];
  if (includeHeader) lines.push(columns.map(escapeCsv).join(","));
  for (const row of rows) lines.push(columns.map((column) => escapeCsv(row[column])).join(","));
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [header = [], ...records] = rows.filter((item) => item.length && item.some(Boolean));
  return records.map((record) =>
    Object.fromEntries(header.map((column, index) => [column, record[index] ?? ""]))
  );
}

export async function appendHistory(products) {
  await ensureDir(path.dirname(HISTORY_PATH));
  const hasFile = await exists(HISTORY_PATH);
  const rows = products.map((product) => {
    const row = {};
    for (const column of HISTORY_COLUMNS) row[column] = product[column] ?? "";
    return row;
  });

  if (hasFile) {
    const currentCsv = await readFile(HISTORY_PATH, "utf8");
    const currentHeader = currentCsv.split(/\r?\n/, 1)[0];
    if (currentHeader !== HISTORY_COLUMNS.join(",")) {
      const existingRows = parseCsv(currentCsv);
      await writeFile(
        HISTORY_PATH,
        stringifyRows(HISTORY_COLUMNS, [...existingRows, ...rows], true),
        "utf8"
      );
      return;
    }
  }

  await appendFile(HISTORY_PATH, stringifyRows(HISTORY_COLUMNS, rows, !hasFile), "utf8");
}

export async function readHistory() {
  if (!(await exists(HISTORY_PATH))) return [];
  const csv = await readFile(HISTORY_PATH, "utf8");
  return parseCsv(csv);
}

export async function writeCsv(filePath, rows) {
  await ensureDir(path.dirname(filePath));
  if (!rows.length) {
    await writeFile(filePath, "", "utf8");
    return;
  }
  const columns = Object.keys(rows[0]);
  await writeFile(filePath, stringifyRows(columns, rows, true), "utf8");
}
