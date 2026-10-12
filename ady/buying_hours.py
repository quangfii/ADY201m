from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
import json
from .common import date, normalize, number, rounded, size_key, stamp

def analyze_buying_hours(rows, now=None, window_days=30, min_days=3):
    now = date(now) if now is not None else datetime.now(timezone.utc)
    groups = defaultdict(list)
    for row in rows:
        try:
            timestamp = date(row.get('collected_at'))
        except (ValueError, TypeError):
            continue
        price = number(row.get('actual_price'))
        if not row.get('name') or not row.get('supermarket') or price is None or price <= 0 or not now-timedelta(days=window_days) <= timestamp <= now:
            continue
        identity = row.get('product_id') or row.get('product_url') or normalize(row['name'])
        identifier = json.dumps([row['supermarket'], identity, size_key(row)], ensure_ascii=False, separators=(',', ':'))
        groups[identifier].append({**row, 'timestamp': timestamp, 'price': price})
    products = []
    for identifier, observations in groups.items():
        latest = max(observations, key=lambda row: row['timestamp'])
        samples = defaultdict(list)
        for row in observations:
            local = row['timestamp'].astimezone(timezone(timedelta(hours=7)))
            samples[(local.date().isoformat(), local.hour)].append(row['price'])
        by_hour = defaultdict(list)
        for (day, hour), prices in samples.items():
            by_hour[hour].append(dict(date=day, price=median(prices), observations=len(prices)))
        hours = [dict(hour=hour, days=len(items), observations=sum(item['observations'] for item in items),
            median_price=rounded(median([item['price'] for item in items])), min_price=min(item['price'] for item in items),
            max_price=max(item['price'] for item in items)) for hour, items in sorted(by_hour.items())]
        eligible = [hour for hour in hours if hour['days'] >= min_days]
        ranked = eligible if len(eligible) >= 2 else hours
        common = set.intersection(*[{item['date'] for item in by_hour[hour['hour']]} for hour in ranked]) if len(ranked) >= 2 else set()
        prices_by_date = {hour['hour']: {item['date']: item['price'] for item in by_hour[hour['hour']]} for hour in ranked}
        baselines = {day: median([prices_by_date[hour['hour']][day] for hour in ranked]) for day in common}
        ranking = sorted([dict(hour=hour['hour'], median_price=rounded(median([prices_by_date[hour['hour']][day] for day in common])),
            relative_price=median([prices_by_date[hour['hour']][day]/baselines[day] for day in common])) for hour in ranked],
            key=lambda hour: (hour['relative_price'], hour['hour'])) if common else []
        for hour in hours:
            hour['comparison_median_price'] = next((item['median_price'] for item in ranking if item['hour']==hour['hour']), None)
        enough = len(eligible) >= 2 and len(common) >= min_days
        best = ranking[0] if ranking else None
        spread = (ranking[-1]['relative_price'] - best['relative_price']) / ranking[-1]['relative_price'] if best else 0
        status = 'insufficient' if not best else 'no_hour_advantage' if spread < .005 else 'recommended' if enough else 'provisional'
        best_hours = [item['hour'] for item in ranking if abs(item['relative_price']-best['relative_price']) < 1e-9] if best and status != 'no_hour_advantage' else []
        age = now - latest['timestamp']
        products.append(dict(id=identifier, supermarket=latest['supermarket'], product_id=latest.get('product_id') or '',
            name=latest['name'], category=latest.get('category') or '', size=latest.get('size') or '',
            product_url=latest.get('product_url') or '', status=status, sufficient_history=enough,
            stale=age > timedelta(hours=48), observed_days=len({day for day, hour in samples}), observed_hours=len(hours),
            common_days=len(common), latest_collected_at=latest['collected_at'], latest_price=latest['price'],
            best_hours=best_hours, typical_best_price=best['median_price'] if best_hours else None,
            relative_saving_percent=rounded(spread * 10000)/100 if best_hours else None,
            current_price_is_good=latest['price'] <= best['median_price'] if status=='recommended' and age <= timedelta(minutes=90) else None,
            hours=hours))
    order = {'recommended': 0, 'provisional': 1, 'no_hour_advantage': 2, 'insufficient': 3}
    products.sort(key=lambda item: (order[item['status']], normalize(item['name'])))
    summary = {status: sum(item['status']==status and (not item['stale'] if status=='recommended' else True) for item in products) for status in order}
    summary['products'] = len(products)
    return dict(timezone='Asia/Ho_Chi_Minh', window_days=window_days, minimum_common_days=min_days,
                generated_at=stamp(now), summary=summary, products=products)
