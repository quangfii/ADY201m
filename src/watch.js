import { runScrape } from "./scrape.js";
import { log } from "./utils/logger.js";

const intervalMinutes = Number.parseInt(process.env.SCRAPE_INTERVAL_MINUTES || "60", 10);
const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

async function tick() {
  await runScrape().catch((error) => log("Lan cao du lieu bi loi", { error: error.message }));
}

await log("Bat dau theo doi gia", { interval_minutes: intervalMinutes });
await tick();
setInterval(tick, intervalMs);
