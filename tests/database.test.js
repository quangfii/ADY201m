import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareObservations } from '../src/storage/database.js';
test('validates prices and time, deduplicates each store snapshot and preserves hourly snapshots', () => {
 const row={collected_at:'2026-10-11T00:00:00Z',supermarket:'winmart',product_id:'123',name:'Sữa 1l',actual_price:30000};
 const prepared=prepareObservations([row,row,{...row,actual_price:0},{...row,collected_at:'bad'},{...row,collected_at:'2026-10-11T01:00:00Z',actual_price:35000},{...row,supermarket:'bachhoaxanh'}]);
 assert.equal(prepared.length,3);
 assert.equal(new Set(prepared.map(r=>r.id)).size,3);
 assert.equal(JSON.parse(prepared[0].payload).name,'Sữa 1l');
});
