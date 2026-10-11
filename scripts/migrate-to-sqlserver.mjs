import { DatabaseSync } from 'node:sqlite';
import { saveObservations, database, sqlHistory, executeSql } from '../src/storage/database.js';
import { existsSync } from 'node:fs';
database();
if (existsSync('data/prices.sqlite')) {
  const old = new DatabaseSync('data/prices.sqlite', {readOnly:true});
  const rows = old.prepare('SELECT payload FROM observations').all().map(r=>JSON.parse(r.payload));
  old.close();
  const added = saveObservations(rows);
  const migrated = new Set(sqlHistory().map(r=>JSON.stringify([r.collected_at,r.supermarket,r.product_id||r.product_url||r.match_key||r.name])));
  for(const r of rows) if(!migrated.has(JSON.stringify([new Date(r.collected_at).toISOString(),r.supermarket,r.product_id||r.product_url||r.match_key||r.name]))) throw Error('Migration verification failed');
  console.log(JSON.stringify({source_rows:rows.length,inserted:added,sql_rows:sqlHistory().length,verified:true}));
}
console.log(executeSql('SELECT COUNT(*) AS observations FROM dbo.PriceObservations;'));
