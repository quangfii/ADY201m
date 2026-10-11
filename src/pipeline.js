import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { runAnalysis } from './analyze.js';
import { log } from './utils/logger.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'src', script)], {cwd: root, stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
  });
}
export async function runPipeline() {
  process.chdir(root);
  mkdirSync(path.join(root, 'data'), {recursive: true});
  const lockPath = path.join(root, 'data', 'pipeline.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Chu ky khac dang chay: data/pipeline.lock'); throw error; }
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, started_at: new Date().toISOString()}));
    await log('Bat dau chu ky SQL theo gio');
    await run(process.env.SCRAPE_SCOPE === 'configured' ? 'scrape.js' : 'scrape-all.js');
    await runAnalysis();
    await run('build-catalog.js');
    await log('Hoan tat chu ky SQL va phan tich');
  } catch (error) {
    await log('Chu ky SQL that bai', {error: error.stack || error.message});
    throw error;
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runPipeline().catch(error => {console.error(error); process.exitCode = 1;});
