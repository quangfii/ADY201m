# Grocery Price Comparison: Bach Hoa Xanh vs WinMart

Du an theo doi bien dong gia san pham giua Bach Hoa Xanh va WinMart theo thoi gian.

## Muc tieu

- Cao du lieu gia san pham theo lich lap lai.
- Luu lai lich su gia de quan sat tang/giam theo thoi diem, khuyen mai.
- So sanh cung mot san pham giua Bach Hoa Xanh va WinMart.
- Thong ke gia cao nhat, thap nhat, trung binh, chenhlech.
- Goi y noi mua phu hop theo san pham hoac gio hang.

## Cau truc du lieu thu thap

Moi dong du lieu gom:

- `collected_at`: thoi diem thu thap
- `supermarket`: `winmart` hoac `bachhoaxanh`
- `product_id`: ma san pham neu lay duoc
- `name`: ten san pham
- `brand`: thuong hieu neu tach duoc
- `category`: nhom san pham
- `size`: khoi luong/dung tich neu tach duoc
- `original_price`: gia goc
- `sale_price`: gia khuyen mai neu co
- `actual_price`: gia thuc te de so sanh
- `discount_text`: noi dung khuyen mai neu co
- `product_url`: link san pham
- `source_url`: trang danh muc da cao

## Cai dat

```bash
npm install
npx playwright install chromium
```

## Cao du lieu mot lan

```bash
npm run scrape
```

Du lieu se duoc ghi vao:

- `data/raw/YYYY-MM-DD/*.json`
- `data/processed/price_history.csv`
- `logs/scrape.log`

## Theo doi lien tuc

Mac dinh chay moi 60 phut:

```bash
npm run scrape:watch
```

Chay moi 30 phut:

```bash
SCRAPE_INTERVAL_MINUTES=30 npm run scrape:watch
```

Tren PowerShell:

```powershell
$env:SCRAPE_INTERVAL_MINUTES=30
npm run scrape:watch
```

## Phan tich

```bash
npm run analyze
```

Ket qua:

- `reports/product_price_comparison.csv`
- `reports/category_price_summary.csv`
- `reports/basket_comparison.csv`
- `reports/price_volatility.csv`
- `reports/summary.json`

## Tuy chinh nguon cao

Sua `config/sources.json` de them danh muc, vi du thit, hai san, sua, rau cu.

Luu y: cac website ban le co the thay doi HTML, API, hoac chan truy cap tu dong. Neu crawler khong lay duoc du lieu, can cap nhat selector/API trong `src/scrapers`.
