"""Rendered pages via Python Playwright, product extraction via BeautifulSoup."""
import asyncio
import json
import os
import re
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urljoin, urlparse
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout
from .common import ROOT, SIZE, log, normalize, parse_price, read_json, stamp, write_json

PRICE = re.compile(r'(?:\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:₫|đ|VND)(?!\w)', re.I)

def normalized(raw, source, collected_at):
    name = re.sub(r'\s+', ' ', str(raw.get('name') or '')).strip()
    size = raw.get('size') or (SIZE.search(name)[0] if SIZE.search(name) else '')
    result = dict(collected_at=collected_at, supermarket=source['supermarket'], product_id=raw.get('product_id') or '', name=name,
        brand=raw.get('brand') or (name.split()[0] if len(name.split())>1 and re.fullmatch('[A-Z0-9]+',name.split()[0]) else ''),
        category=source.get('category') or '', size=size, discount_text=raw.get('discount_text') or '', image_url=raw.get('image_url') or '',
        product_url=raw.get('product_url') or '', source_url=source['url'], match_key=normalize(name+' '+size))
    for key in ('original_price','sale_price','actual_price'):
        result[key] = parse_price(raw.get(key)) or ''
    return result

def extract_products(html, source, collected_at):
    soup = BeautifulSoup(html, 'html.parser')
    winmart = source['supermarket']=='winmart'
    raw = []
    for card in soup.select('.product-card' if winmart else '.box_product'):
        text = card.get_text('\n', strip=True)
        prices = PRICE.findall(text)
        image = card.select_one('img.product-image[alt]' if winmart else 'img[alt]')
        title = card.select_one('h3.product_name')
        name = image.get('alt','') if winmart and image else title.get_text(' ',strip=True) if title else image.get('alt','') if image else ''
        link = card.select_one('a[href*="/products/"]' if winmart else 'a[id^="product_"][href]')
        if not link and title:
            link = title.find_parent('a')
        url = urljoin(source['url'], link.get('href','')) if link else ''
        identifier = re.search(r'--s(\d+)',url) if winmart else None
        code = card.select_one('[product-code]')
        size = SIZE.search(text)
        raw.append(dict(name=name, size=size[0] if size else '', product_id=identifier[1] if identifier else code.get('product-code','') if code else '',
            original_price=prices[1] if len(prices)>1 else '', sale_price=prices[0] if prices else '', actual_price=prices[0] if prices else '',
            discount_text=next((line for line in text.splitlines() if re.search(r'%|giam|khuyen mai|sale|mua|tang',normalize(line))), ''),
            image_url=urljoin(source['url'],image.get('src') or image.get('data-src') or '') if image else '', product_url=url))
    raw = [row for row in raw if row['name'] and row['actual_price']]
    if not raw:
        def visit(node):
            if isinstance(node,list):
                for child in node: visit(child)
            elif isinstance(node,dict):
                if 'product' in str(node.get('@type','')).lower():
                    offers = node.get('offers') or {}
                    if isinstance(offers,list): offers = offers[0] if offers else {}
                    brand = node.get('brand') or ''
                    raw.append(dict(name=node.get('name'), brand=brand.get('name','') if isinstance(brand,dict) else brand,
                        actual_price=offers.get('price') or offers.get('lowPrice'), product_url=urljoin(source['url'],node.get('url') or '')))
                for child in node.values(): visit(child)
        for script in soup.select('script[type="application/ld+json"]'):
            try: visit(json.loads(script.get_text()))
            except (ValueError,TypeError): pass
    result = {}
    for row in raw:
        product = normalized(row,source,collected_at)
        if product['name'] and product['actual_price']:
            result[(product['name'],product['actual_price'],product['product_url'])] = product
    return list(result.values())

async def page_products(page, source, collected_at):
    await page.goto(source['url'], wait_until='domcontentloaded', timeout=90000)
    try: await page.wait_for_load_state('networkidle',timeout=30000)
    except BrowserTimeout: pass
    try: await page.wait_for_selector('.product-card' if source['supermarket']=='winmart' else 'h3.product_name',timeout=30000)
    except BrowserTimeout: pass
    # Bound infinite-scroll pages; scroll input is controlled by Playwright.
    previous = 0
    for _ in range(80):
        await page.mouse.wheel(0,700)
        await asyncio.sleep(.25)
        html = await page.content()
        length = len(html)
        if length==previous:
            break
        previous = length
    return extract_products(await page.content(),source,collected_at)

async def discover(context, previous):
    configured = read_json(ROOT / 'config/sources.json', {})
    cached = read_json(ROOT / 'data/discovered_sources.json', {})
    found = {}
    page = await context.new_page()
    try:
        await page.goto('https://winmart.vn/',wait_until='domcontentloaded',timeout=90000)
        await asyncio.sleep(5)
        soup = BeautifulSoup(await page.content(),'html.parser')
        links = {urljoin('https://winmart.vn/',anchor['href']):anchor.get_text(' ',strip=True) for anchor in soup.select('a[href*="--c"]') if re.search(r'--c\d+',anchor['href']) and anchor.get_text(strip=True)}
        found['winmart'] = [dict(url=url,category=name) for url,name in links.items()]
    except Exception as error:
        log('Lỗi phát hiện WinMart',error=str(error))
    finally:
        await page.close()
    try:
        response = await context.request.get('https://www.bachhoaxanh.com/sitemapnew/sitemap-cate',timeout=30000)
        if not response.ok: raise RuntimeError(f'Sitemap BHX HTTP {response.status}')
        xml = ET.fromstring(await response.text())
        found['bachhoaxanh'] = [dict(url=node.text,category=unquote(urlparse(node.text).path.strip('/')).replace('-',' ')) for node in xml.iter() if node.tag.split('}')[-1]=='loc' and node.text]
    except Exception as error:
        log('Lỗi sitemap BHX',error=str(error))
    for store in ('winmart','bachhoaxanh'):
        historical = {row['source_url']:dict(category=row.get('category',''),url=row['source_url']) for row in previous if row['supermarket']==store and row.get('source_url')}
        if not found.get(store):
            found[store] = list(historical.values()) or cached.get(store) or configured.get(store) or []
            log('Dùng danh mục dự phòng',supermarket=store,categories=len(found[store]))
    write_json(ROOT / 'data/discovered_sources.json',found)
    return found

async def scrape(database, configured_only=False):
    previous = database.history()
    collected_at = stamp()
    concurrency = max(1,min(4,int(os.environ.get('SCRAPE_CONCURRENCY','3'))))
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(locale='vi-VN')
            categories = read_json(ROOT / 'config/sources.json',{}) if configured_only else await discover(context,previous)
            sources = [dict(**source,supermarket=store) for store in ('winmart','bachhoaxanh') for source in categories.get(store,[])]
            limit = int(os.environ.get('MAX_CATEGORIES','0'))
            if limit>0: sources = sources[:limit]
            queue = asyncio.Queue()
            for source in sources: queue.put_nowait(source)
            products = []
            async def worker():
                page = await context.new_page()
                try:
                    while not queue.empty():
                        source = queue.get_nowait()
                        try:
                            rows = await page_products(page,source,collected_at)
                            products.extend(rows)
                            log('Đã cào danh mục',supermarket=source['supermarket'],category=source['category'],count=len(rows))
                        except Exception as error:
                            log('Lỗi danh mục',url=source['url'],error=str(error))
                finally: await page.close()
            await asyncio.gather(*(worker() for _ in range(concurrency)))
        finally: await browser.close()
    unique = {}
    for product in products:
        key = product['supermarket'], product['product_id'] or product['product_url'] or product['match_key']
        unique.setdefault(key,product)
    rows = list(unique.values())
    if not rows: raise RuntimeError('Không thu được sản phẩm; không cập nhật báo cáo bằng dữ liệu cũ.')
    inserted = database.save(rows)
    database.export()
    write_json(ROOT / f'data/raw/{collected_at[:10]}/all-{collected_at[11:19].replace(":", "")}.json',rows)
    log('Hoàn tất thu thập Python',count=len(rows),inserted=inserted)
    return len(rows)
