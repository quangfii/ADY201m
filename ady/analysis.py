from collections import defaultdict
from datetime import timedelta
import re
from urllib.parse import unquote
from .common import ROOT, SIZE, date, normalize, number, read_json, rounded, size_key, stamp, write_csv, write_json
from .buying_hours import analyze_buying_hours

def valid(row):
    name = str(row.get('name') or '').strip()
    price = number(row.get('actual_price'))
    return bool(name and price is not None and price > 0 and not re.fullmatch(r'them vao gio|mua|trang chu', normalize(name), re.I)
        and not re.fullmatch(r'[+-]?\d+%', name)
        and not re.fullmatch(r'(?:\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:₫|d|đ|vnd)', name, re.I))

def identity(row):
    return row['supermarket'], str(row.get('product_id') or row.get('product_url') or row.get('match_key') or normalize(row['name']))

def latest_rows(rows):
    latest = {}
    for row in rows:
        key = identity(row)
        if key not in latest or date(row['collected_at']) > date(latest[key]['collected_at']):
            latest[key] = row
    return list(latest.values())

def comparison_key(row):
    text = ' '.join(str(row.get(key) or '') for key in ('size','name','product_url'))
    match = SIZE.search(text)
    if not match:
        return 'unverified|' + row['supermarket'] + '|' + str(row.get('product_id') or row.get('product_url') or row['name'])
    quantity, unit = match.groups()
    quantity = float(quantity.replace(',', '.')) * (1000 if unit.lower() in ('kg','l') else 1)
    name = re.sub(r'\b\d+(?: \d+)?\s*(kg|g|ml|l)\b', '', normalize(row['name'])).strip()
    return f"{name}|{quantity:g}{'g' if unit.lower() in ('kg','g') else 'ml'}"

def compare_products(rows):
    groups = defaultdict(list)
    for row in latest_rows(rows):
        groups[comparison_key(row)].append(row)
    result = []
    for key, items in groups.items():
        stores = {store: min((row for row in items if row['supermarket']==store), key=lambda row: float(row['actual_price']), default=None) for store in ('winmart','bachhoaxanh')}
        winmart, bhx = stores.values()
        aligned = winmart and bhx and abs(date(winmart['collected_at'])-date(bhx['collected_at'])) <= timedelta(minutes=90)
        diff = float(bhx['actual_price']) - float(winmart['actual_price']) if aligned else None
        sample = winmart or bhx
        result.append(dict(match_key=key, sample_name=sample['name'], category=sample.get('category') or '',
            winmart_price=float(winmart['actual_price']) if winmart else '', bachhoaxanh_price=float(bhx['actual_price']) if bhx else '',
            difference_bhx_minus_winmart=diff if diff is not None else '', absolute_difference=abs(diff) if diff is not None else '',
            cheaper_at='not_comparable' if diff is None else 'winmart' if diff > 0 else 'bachhoaxanh' if diff < 0 else 'same',
            winmart_url=winmart.get('product_url','') if winmart else '', bachhoaxanh_url=bhx.get('product_url','') if bhx else '',
            winmart_collected_at=winmart['collected_at'] if winmart else '', bachhoaxanh_collected_at=bhx['collected_at'] if bhx else ''))
    return sorted(result, key=lambda row: -(row['absolute_difference'] or 0))

def analyze(rows):
    rows_valid = [row for row in rows if valid(row)]
    comparisons = compare_products(rows_valid)
    comparable = [row for row in comparisons if row['absolute_difference'] != '']
    grouped = defaultdict(list)
    for row in comparable:
        grouped[row['category'] or 'Khong ro'].append(row['absolute_difference'])
    categories_summary = sorted([dict(category=category, comparable_products=len(prices), min_difference=min(prices),
        max_difference=max(prices), avg_difference=rounded(sum(prices)/len(prices))) for category, prices in grouped.items()], key=lambda row: -row['avg_difference'])
    grouped = defaultdict(list)
    for row in rows_valid:
        grouped[identity(row)].append(row)
    volatility = []
    for items in grouped.values():
        first = min(items, key=lambda row: date(row['collected_at']))
        prices = [float(item['actual_price']) for item in items]
        volatility.append(dict(supermarket=first['supermarket'], match_key=first.get('match_key',''), name=first['name'], category=first.get('category',''),
            observations=len(prices), min_price=min(prices), max_price=max(prices), avg_price=rounded(sum(prices)/len(prices)), price_range=max(prices)-min(prices)))
    volatility.sort(key=lambda row: -row['price_range'])
    basket = []
    for item in read_json(ROOT / 'config/basket.json', []):
        wanted = normalize(item['name'])
        matched = next((row for row in comparisons if wanted in row['match_key'] or row['match_key'] in wanted), {})
        quantity = float(item.get('quantity') or 1)
        basket.append(dict(basket_item=item['name'], matched_product=matched.get('sample_name',''), quantity=quantity,
            winmart_total=float(matched['winmart_price'])*quantity if number(matched.get('winmart_price')) is not None else '',
            bachhoaxanh_total=float(matched['bachhoaxanh_price'])*quantity if number(matched.get('bachhoaxanh_price')) is not None else '', cheaper_at=matched.get('cheaper_at','not_found')))
    buying = analyze_buying_hours(rows_valid)
    categories = []
    latest = latest_rows(rows_valid)
    for category in dict.fromkeys(row.get('category','') for row in rows_valid):
        result = {'category': category}
        for store in ('winmart','bachhoaxanh'):
            prices = [float(row['actual_price']) for row in latest if row.get('category','')==category and row['supermarket']==store]
            result[store] = rounded(sum(prices)/len(prices)) if prices else None
            result[store+'_count'] = len(prices)
        categories.append(result)
    summary = dict(generated_at=stamp(), total_observations=len(rows), valid_observations=len(rows_valid), rejected_observations=len(rows)-len(rows_valid),
        comparable_products=len(comparable), largest_difference=comparable[0] if comparable else None,
        category_with_highest_avg_difference=categories_summary[0] if categories_summary else None,
        most_volatile_product=volatility[0] if volatility else None,
        diagnostic_notes=['Chênh lệch có thể do khuyến mãi, quy cách, cửa hàng và thời điểm thu thập.', 'Cần nhiều mốc giờ và ngày chung để phân tích giờ mua.'])
    for filename, values in [('product_price_comparison',comparisons), ('category_price_summary',categories_summary), ('basket_comparison',basket), ('price_volatility',volatility), ('category_prices',categories),
        ('buying_hour_summary',[{**{key:value for key,value in product.items() if key!='hours'}, 'best_hours':';'.join(map(str,product['best_hours']))} for product in buying['products']]),
        ('hourly_product_prices',[dict(product_id=product['product_id'], name=product['name'], supermarket=product['supermarket'], size=product['size'], **hour) for product in buying['products'] for hour in product['hours']])]:
        write_csv(ROOT / f'reports/{filename}.csv', values)
    write_json(ROOT / 'reports/summary.json', summary)
    report = dict(summary=summary, comparisons=comparisons, categories=categories, volatility=volatility, basket=basket,
        buying_hours=buying, recommendations=[row for row in comparable if row['cheaper_at']!='same'],
        history=[dict(collected_at=row['collected_at'], supermarket=row['supermarket'], name=row['name'], match_key=comparison_key(row), actual_price=float(row['actual_price'])) for row in rows_valid])
    write_json(ROOT / 'public/analytics.json', report)
    return report

def catalog(rows):
    products = []
    for row in latest_rows([row for row in rows if valid(row) and float(row['actual_price'])>=1000 and normalize(row['name'])!='hom nay an gi']):
        size = row.get('size') or ''
        for candidate in (size, row['name'], unquote(row.get('product_url') or '')):
            match = SIZE.search(candidate)
            if match:
                size = ''.join(match.groups()).replace(',', '.').lower()
                break
        quantity_match = SIZE.search(size + ' ' + row['name'])
        base = float(quantity_match[1].replace(',','.')) * (1000 if quantity_match[2].lower() in ('kg','l') else 1) if quantity_match else None
        price = float(row['actual_price'])
        product = {key:row.get(key) or '' for key in ('supermarket','name','brand','category','discount_text','image_url','product_url','collected_at')}
        product.update(id=row['supermarket']+'-'+str(row.get('product_id') or normalize(row.get('product_url') or row['name'])), normalized_name=normalize(row['name']), size=size,
            original_price=number(row.get('original_price')) if (number(row.get('original_price')) or 0)>0 else None,
            sale_price=number(row.get('sale_price')) if (number(row.get('sale_price')) or 0)>0 else None,
            actual_price=price, unit_price=rounded(price/base*1000) if base else None,
            unit_label=('1 lít' if quantity_match[2].lower() in ('ml','l') else '1 kg') if base else '')
        products.append(product)
    products.sort(key=lambda row: normalize(row['name']))
    result = dict(generated_at=stamp(), count=len(products), products=products)
    write_json(ROOT / 'public/catalog.json', result)
    return result
