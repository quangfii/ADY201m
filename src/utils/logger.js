import { appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./fs.js";

const LOG_PATH = path.resolve("logs", "scrape.log");

export async function log(message, meta = {}) {
  await ensureDir(path.dirname(LOG_PATH));
  const line = JSON.stringify({
    at: new Date().toISOString(),
    message,
    ...meta
  });
  await appendFile(LOG_PATH, `${line}\n`, "utf8");
  console.log(message);
}
