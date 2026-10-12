import hashlib
import json
import unittest
from ady.database import prepare
from ady.analysis import compare_products
from ady.buying_hours import analyze_buying_hours
from ady.scraper import extract_products

NOW = '2026-10-11T12:00:00Z'
def row(day, hour, price, **overrides):
    return dict(supermarket='winmart', product_id='milk', name='Sữa ABC', size='1l', actual_price=price,
                collected_at=f'{day}T{hour:02d}:00:00+07:00', **overrides)

class AnalysisTests(unittest.TestCase):
    def analyze(self, rows):
        return analyze_buying_hours(rows, now=NOW)['products']

    def test_common_days(self):
        rows = [row(day,hour,price) for day in ('2026-10-09','2026-10-10','2026-10-11') for hour,price in ((9,30000),(15,25000))]
        product = self.analyze(rows)[0]
        self.assertEqual((product['status'],product['best_hours'],product['common_days']),('recommended',[15],3))
        self.assertEqual(product['relative_saving_percent'],16.67)
        self.assertEqual(product['typical_best_price'],25000)
        rows += [row('2026-10-11',9,30000) for _ in range(10)]
        self.assertEqual(self.analyze(rows)[0]['hours'][0]['days'],3)
        self.assertEqual(self.analyze(rows)[0]['hours'][0]['observations'],13)

    def test_insufficient_and_provisional(self):
        self.assertEqual(self.analyze([row('2026-10-11',9,30000)])[0]['status'],'insufficient')
        self.assertEqual(self.analyze([row('2026-10-11',9,30000),row('2026-10-11',15,25000)])[0]['status'],'provisional')

    def test_date_trend_is_not_hour_effect(self):
        self.assertEqual(self.analyze([row('2026-10-09',9,30000),row('2026-10-10',15,25000)])[0]['status'],'insufficient')
        rows = [row(day,hour,30000-i*5000) for i,day in enumerate(('2026-10-09','2026-10-10','2026-10-11')) for hour in (9,15)]
        self.assertEqual(self.analyze(rows)[0]['status'],'no_hour_advantage')
        self.assertEqual(self.analyze(rows)[0]['best_hours'],[])

    def test_separate_products_and_stores(self):
        base=row('2026-10-11',9,30000)
        rows=[base,{**base,'supermarket':'bachhoaxanh'},{**base,'product_id':'other'},{**base,'size':'500ml'}]
        self.assertEqual(len(self.analyze(rows)),4)

    def test_local_midnight_stale_and_invalid(self):
        base=row('2026-10-01',0,30000)
        rows=[{**base,'collected_at':'2026-09-30T17:30:00Z'},{**base,'actual_price':0},{**base,'collected_at':'invalid'},{**base,'collected_at':'2026-10-12T01:00:00Z'},{**base,'collected_at':'2026-08-01T01:00:00Z'}]
        products=self.analyze(rows)
        self.assertEqual(len(products),1)
        self.assertEqual(products[0]['hours'][0]['hour'],0)
        self.assertTrue(products[0]['stale'])
        self.assertIsNone(products[0]['current_price_is_good'])

    def test_product_comparison_and_alignment(self):
        base=row('2026-10-11',9,30000)
        rows=[base,{**base,'supermarket':'bachhoaxanh','size':'1000ml','actual_price':25000},
              {**base,'name':'Thiếu quy cách','size':'','product_id':'unknown'},
              {**base,'name':'Thiếu quy cách','size':'','product_id':'unknown','supermarket':'bachhoaxanh'}]
        results=compare_products(rows)
        self.assertEqual(len([r for r in results if r['absolute_difference']!='']),1)
        self.assertEqual(results[0]['cheaper_at'],'bachhoaxanh')
        rows[1]['collected_at']='2026-10-09T00:00:00Z'
        self.assertEqual(len([r for r in compare_products(rows) if r['absolute_difference']!='']),0)

    def test_existing_sha_and_invalid_rows(self):
        base=row('2026-10-11',9,30000)
        results=prepare([base,base,{**base,'actual_price':-1},{**base,'collected_at':'wrong'}])
        self.assertEqual(len(results),1)
        key=json.dumps(['2026-10-11T02:00:00.000Z','winmart','milk'],ensure_ascii=False,separators=(',',':'))
        self.assertEqual(results[0]['id'],hashlib.sha256(key.encode()).hexdigest())

    def test_dom_and_structured_extraction(self):
        source=dict(supermarket='winmart',category='Sữa',url='https://winmart.vn/category')
        html='<div class="product-card"><a href="/products/milk--s123"><img class="product-image" alt="Sữa ABC 1l" src="/milk.png"></a><p>25.000 đ</p><p>30.000 đ</p></div>'
        product=extract_products(html,source,NOW)[0]
        self.assertEqual((product['actual_price'],product['original_price'],product['product_id']),(25000,30000,'123'))
        html='<script type="application/ld+json">{"@type":"Product","name":"Sữa","offers":{"price":25000},"url":"/milk"}</script>'
        self.assertEqual(extract_products(html,source,NOW)[0]['actual_price'],25000)
        source['supermarket']='bachhoaxanh'
        html='<div class="box_product"><a id="product_1" href="/milk"><h3 class="product_name">Sữa ABC 1l</h3></a><span product-code="123"></span><p>25.000₫</p></div>'
        self.assertEqual(extract_products(html,source,NOW)[0]['product_id'],'123')

if __name__=='__main__': unittest.main()
