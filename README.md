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

## SQL Server và phân tích tự động

Yêu cầu Node.js 24.15 trở lên. SQL Server được cấu hình trong config/sqlserver.json: server localhost, database ADY201m, Windows Authentication. Bảng dữ liệu: dbo.PriceObservations; dữ liệu CSV cũ được nhập một lần, chống trùng theo siêu thị, sản phẩm và thời điểm. CSV vẫn được xuất để sử dụng trong Excel.

- npm run pipeline: cào toàn bộ danh mục phát hiện được → lưu SQL Server → phân tích → cập nhật catalog và analytics.json.
- npm run scrape:watch: chạy ngay rồi lặp mỗi 60 phút; mỗi lần chỉ có một chu kỳ.
- npm run analyze: phân tích lịch sử trong SQL.
- npm start: mở http://localhost:4173/analytics.html để xem bảng, biểu đồ nhóm hàng, lịch sử giá và gợi ý mua.
- SCRAPE_SCOPE=configured: chỉ cào các URL trong config/sources.json. Mặc định pipeline phát hiện toàn bộ danh mục.

Giá chỉ được ghép giữa hai siêu thị khi tên chuẩn hóa và khối lượng/dung tích giống nhau. Sản phẩm thiếu quy cách được giữ riêng. Giá trung bình nhóm hàng có thể dựa trên danh mục khác nhau. Gợi ý chưa tính phí giao hàng. Nhiều quan sát cùng một thời điểm không đủ để kết luận xu hướng.

Tác vụ Windows ADY201m-Hourly-Prices chạy Node trực tiếp mỗi giờ. scripts/hourly.ps1 cũng có thể chạy thủ công. Máy cần bật và có mạng; tác vụ chạy theo tài khoản đăng nhập. Log tác vụ: logs/scrape.log; script thủ công: logs/hourly.log. Nếu chương trình bị tắt đột ngột, kiểm tra tiến trình trong data/pipeline.lock trước khi xóa file khóa để chạy lại.

Nếu sitemap lỗi, hệ thống dùng danh mục từ lịch sử SQL, cache hoặc config. So sánh giữa hai siêu thị yêu cầu thời điểm giá cách nhau không quá 90 phút.

Mở SQL Server Management Studio: Server name localhost, Windows Authentication → Databases → ADY201m → Tables → dbo.PriceObservations → Select Top 1000 Rows. Có thể dùng scripts/view-prices.sql. File data/prices.sqlite chỉ là bản cũ để bảo toàn lịch sử; ứng dụng không ghi hay đọc file này nữa. npm run db:migrate chỉ dùng một lần để chuyển dữ liệu cũ, có kiểm tra từng bản ghi.

## Tài liệu dự án

[Tài liệu Word mô tả dự án và hướng dẫn vận hành](docs/ADY201m_Tai_lieu_du_an.docx)

[GitHub Projects ADY201m](https://github.com/users/quangfii/projects/1) dùng theo dõi công việc và hướng phát triển.

## Phân tích giờ nên mua

Mục Giờ nào nên mua trong /analytics.html phân tích 30 ngày gần nhất theo giờ Việt Nam. Dữ liệu được tách theo siêu thị, định danh sản phẩm và quy cách. Mỗi ngày và khung giờ lấy một giá trung vị để các lần cào lặp không làm lệch trọng số.

Xếp hạng dùng giá tương đối so với trung vị cùng ngày, chỉ trên các ngày chung của các giờ so sánh. Cần ít nhất hai khung giờ và ba ngày chung để đưa ra khuyến nghị. Khi chưa đủ, kết quả là tham khảo hoặc chưa đủ dữ liệu. Giá gần như bằng nhau (chênh lệch tương đối dưới 0,5%) không được coi là lợi thế giờ mua. Không suy đoán giá cho giờ chưa có dữ liệu. Dữ liệu quá 48 giờ được đánh dấu cũ.

Báo cáo mới: reports/buying_hour_summary.csv và reports/hourly_product_prices.csv. Lịch cào mỗi giờ tự cập nhật kết quả sau mỗi chu kỳ.
