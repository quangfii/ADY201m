# ADY201m so sánh giá bằng Python và SQL Server

Dự án thu thập giá WinMart và Bách Hóa Xanh mỗi giờ, lưu lịch sử vào SQL Server và phân tích theo sản phẩm, nhóm hàng, thời gian và giờ mua. Python thực hiện toàn bộ xử lý phía máy chủ; SQL định nghĩa bảng và truy vấn. Giao diện dùng HTML, CSS và JavaScript cho biểu đồ trên trình duyệt.

## Cài đặt Windows

Cần Python 3.12 trở lên, SQL Server và sqlcmd ODBC. Mở terminal tại thư mục dự án:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Sửa `config/sqlserver.json` cho máy chạy. Mặc định: `localhost`, database `ADY201m`, Windows Authentication. Không lưu mật khẩu trong repository. `sql/schema.sql` tự tạo bảng nếu chưa có; không xóa hay thay dữ liệu hiện tại. `scripts/view-prices.sql` dùng trong SSMS.

## Chạy

```powershell
python -m ady pipeline
python -m ady serve
```

Mở http://localhost:4174/analytics.html. `pipeline` cào → lưu SQL → phân tích → cập nhật catalog và báo cáo. Không cần Node.js. Server chỉ phục vụ thư mục `public` và mặc định chỉ truy cập từ máy này.

Các lệnh khác:

- `python -m ady scrape`: chỉ cào danh mục trong cấu hình và lưu SQL.
- `python -m ady analyze`: đọc SQL, tạo bảng so sánh, biểu đồ và phân tích giờ mua.
- `python -m ady catalog`: cập nhật danh mục sản phẩm từ SQL.
- `python -m ady db-import`: nhập CSV cũ một lần nếu chưa nhập, xuất lịch sử từ SQL.
- `python -m ady watch`: chạy ngay rồi lặp mỗi 60 phút.

## Lịch mỗi giờ

Sau khi cài môi trường, chạy PowerShell:

```powershell
.\scripts\install-hourly.ps1
```

Tác vụ `ADY201m-Hourly-Prices` gọi `.venv\Scripts\python.exe -m ady pipeline` mỗi giờ, dùng thư mục dự án hiện tại. Có thể truyền `-PythonExecutable` để chọn Python khác. Máy phải bật, có mạng, người dùng đăng nhập và SQL Server hoạt động. Chỉ chọn một cơ chế lịch: Task Scheduler hoặc `watch`.

Chu kỳ dùng `data/pipeline.lock` để tránh chạy chồng. Nếu chương trình dừng đột ngột, kiểm tra PID trong file khóa; chỉ xóa khi tiến trình đó đã dừng. Log ở `logs/scrape.log`. Nếu một danh mục lỗi, các danh mục thành công vẫn được lưu. Nếu không lấy được sản phẩm nào, chu kỳ báo lỗi và không tạo báo cáo mới từ dữ liệu cũ.

Mặc định phát hiện toàn bộ danh mục; nếu lỗi dùng lịch sử SQL, cache hoặc cấu hình. Biến môi trường: `SCRAPE_SCOPE=configured`, `MAX_CATEGORIES` (giới hạn cho kiểm tra), `SCRAPE_CONCURRENCY` (1–4), `SCRAPE_INTERVAL_MINUTES` (watch), `PORT`, `HOST`, `SQL_SERVER`, `SQL_DATABASE`.

## Dữ liệu và phương pháp

`dbo.PriceObservations` giữ thời gian UTC, siêu thị, định danh sản phẩm, tên, quy cách, nhóm hàng, giá và JSON gốc. Khóa SHA256 giữ tương thích với lịch sử cũ, chống trùng theo thời điểm, siêu thị và sản phẩm. Không dùng SQLite. Giá xuất CSV ở `data/processed/price_history.csv`; báo cáo CSV ở `reports/`, dữ liệu biểu đồ ở `public/analytics.json`.

So sánh từng sản phẩm dùng giá mới nhất, tên chuẩn hóa và quy cách quy về g/ml. Thiếu quy cách giữ riêng. Hai siêu thị chỉ được so sánh khi thời điểm cách nhau không quá 90 phút. Trung bình nhóm hàng có thể dựa trên danh mục khác nhau. Ghép tên cần kiểm tra nhãn hiệu, số lượng và biến thể. Gợi ý chưa tính phí giao hàng.

Giờ mua được phân tích trong 30 ngày gần nhất theo UTC+7, riêng từng siêu thị, sản phẩm và quy cách. Mỗi ngày và giờ lấy một trung vị. Xếp hạng dùng giá tương đối trên các ngày chung để tránh nhầm biến động theo ngày với ảnh hưởng giờ. Cần ít nhất hai giờ và ba ngày chung để khuyến nghị; ít hơn chỉ tham khảo. Chênh dưới 0,5% không chọn giờ ưu tiên. Dữ liệu quá 48 giờ được đánh dấu cũ. Không suy đoán giờ chưa thu thập và không bảo đảm giá tương lai.

## Kiểm thử

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

Kiểm tra chống trùng và khóa tương thích, quy cách và độ lệch thời gian, giờ Việt Nam, dữ liệu chưa đủ, xu hướng theo ngày và trích xuất sản phẩm từ HTML/JSON-LD.

## Tài liệu

[Tài liệu dự án](docs/ADY201m_Tai_lieu_du_an.docx) • [GitHub Projects](https://github.com/users/quangfii/projects/1)

Cài `requirements-docs.txt` nếu cần chạy `docs/build_project_doc.py`. Database, dataset, log, môi trường Python và cấu hình triển khai riêng tư giữ trên máy, không đưa lên GitHub. Lịch Windows cần cài lại khi clone sang máy khác.
