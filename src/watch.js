import { runPipeline } from "./pipeline.js";
import { log } from "./utils/logger.js";

const intervalMinutes = Number(process.env.SCRAPE_INTERVAL_MINUTES || "60");
if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) throw new Error('Invalid scrape interval');
const intervalMs = intervalMinutes * 60 * 1000;
let stopped = false;
let timer;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {stopped = true; clearTimeout(timer);});

async function tick() {
  const started = Date.now();
  await runPipeline().catch((error) => log("Lan cao du lieu bi loi", { error: error.message }));
  if (!stopped) timer = setTimeout(tick, Math.max(1000, intervalMs - (Date.now() - started)));
}

await log("Bat dau theo doi gia", { interval_minutes: intervalMinutes });
await tick();
