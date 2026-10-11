import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProducts } from '../src/analyze.js';
test('compares equal volumes, keeps unknown sizes apart and rejects mismatched times', () => {
 const base={collected_at:'2026-10-11T00:00:00Z',category:'Sữa',name:'Sữa ABC',size:'1l',actual_price:30000};
 const rows=[{...base,supermarket:'winmart',product_id:'1'},{...base,supermarket:'bachhoaxanh',product_id:'2',size:'1000ml',actual_price:25000},{...base,supermarket:'winmart',product_id:'3',name:'Thiếu quy cách',size:''},{...base,supermarket:'bachhoaxanh',product_id:'4',name:'Thiếu quy cách',size:''}];
 const comparisons=compareProducts(rows);
 assert.equal(comparisons.filter(r=>r.absolute_difference!=='').length,1);
 assert.equal(comparisons[0].absolute_difference,5000);
 assert.equal(comparisons[0].cheaper_at,'bachhoaxanh');
 assert.equal(comparisons.filter(r=>r.sample_name==='Thiếu quy cách').length,2);
 rows[1].collected_at='2026-10-09T00:00:00Z';
 assert.equal(compareProducts(rows).filter(r=>r.absolute_difference!=='').length,0);
});
