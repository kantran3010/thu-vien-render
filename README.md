# Quản lý thư viện – triển khai trên Render.com

Ứng dụng web động (Node.js + Express + EJS + PostgreSQL) cho đề tài 18 – môn Điện toán đám mây.

## Chạy cục bộ (không cần cài PostgreSQL)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 12 kịch bản kiểm thử
```

Không có `DATABASE_URL` thì ứng dụng dùng PGlite (PostgreSQL chạy trong bộ nhớ) và nạp dữ liệu mẫu.

| Tài khoản | Mật khẩu |
|---|---|
| `admin` (thủ thư) | `admin123` |
| `docgia1` … `docgia4` (độc giả) | `docgia123` |

Bản đang chạy: https://thuvien-app.onrender.com

## Triển khai lên Render

1. Đẩy thư mục này lên một kho GitHub (tệp `render.yaml` phải nằm ở thư mục gốc kho).
2. Render Dashboard → **New → Blueprint** → chọn kho → nhập `ADMIN_PASSWORD` → **Apply**.
3. Khi trạng thái là **Live**, mở `https://<tên-dịch-vụ>.onrender.com` và kiểm tra `/healthz`.

Biến môi trường: `DATABASE_URL` (tự nối từ `thuvien-db`), `JWT_SECRET` (Render tự sinh), `ADMIN_PASSWORD` (tự nhập), `SEED_DEMO` (`true` để nạp sách/độc giả mẫu).

Lưu ý gói Free: dịch vụ tự tắt sau 15 phút không truy cập; PostgreSQL miễn phí hết hạn sau 30 ngày và không có sao lưu.
