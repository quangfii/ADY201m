import csv
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIZE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b', re.I)

def stamp(value=None):
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def date(value):
    result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)

def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None

def rounded(value):
    return math.floor(value + .5)

def normalize(value):
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()

def parse_price(value):
    if isinstance(value, (int, float)):
        return number(value)
    text = re.sub(r'[^\d,.]', '', str(value or ''))
    text = re.sub(r'[,.](?=\d{3}\b)', '', text).replace(',', '.')
    return number(text)

def size_key(row):
    match = SIZE.search(f"{row.get('size', '')} {row.get('name', '')}")
    if not match:
        return normalize(row.get('size') or 'unknown')
    quantity, unit = match.groups()
    quantity = float(quantity.replace(',', '.')) * (1000 if unit.lower() in ('kg', 'l') else 1)
    return f"{quantity:g}{'g' if unit.lower() in ('kg','g') else 'ml'}"

def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        return default

def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temporary.replace(path)

def write_csv(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        if rows:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]), extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)

def log(message, **details):
    (ROOT / 'logs').mkdir(exist_ok=True)
    with (ROOT / 'logs/scrape.log').open('a', encoding='utf-8') as handle:
        handle.write(json.dumps({'time': stamp(), 'message': message, **details}, ensure_ascii=False) + '\n')
