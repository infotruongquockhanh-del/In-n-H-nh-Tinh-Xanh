# Database schema — Cloud Firestore

Ứng dụng dùng **backend Node.js + Firebase Admin SDK**. Trình duyệt không đọc/ghi Firestore trực tiếp.

## Collections chính

| Collection | Nội dung |
|---|---|
| `users` | Tài khoản, vai trò, trạng thái, passwordHash tương thích dữ liệu cũ |
| `orders` | Mỗi đơn hàng/báo giá là 1 document |
| `customers` | Hồ sơ CRM khách hàng |
| `inventory` | Vật tư/tồn kho/nhà cung cấp |
| `customProducts` | Hạng mục và quy cách tự thêm |
| `settings` | Payroll, tháng làm việc, điều chỉnh giá, override bảng giá |
| `config/company` | Thông tin công ty |
| `config/priceBook` | Bảng giá gốc 17 hạng mục |
| `config/bootstrap` | Cờ đã khởi tạo dữ liệu lần đầu |
| `auditLogs` | Nhật ký đồng bộ dữ liệu |

## Ánh xạ dữ liệu từ bản HTML cũ

- `htx_users_v6` → `users`
- `htx_auto_quotes_v5` → `orders`
- `htx_customer_profiles_v10` → `customers`
- `htx_inventory_v7` → `inventory`
- `htx_custom_products_v7` → `customProducts`
- `htx_payroll_v17` → `settings/htx_payroll_v17`
- `htx_work_month_v7` → `settings/htx_work_month_v7`
- `htx_price_adjustments_v6` → `settings/htx_price_adjustments_v6`
- `htx_catalog_overrides_v7` → `settings/htx_catalog_overrides_v7`

## Quyền backend

Backend kiểm tra role ở từng lần ghi:
- `director`: toàn quyền, được xóa đơn/khách/tài khoản.
- `accounting`: đơn, khách, tồn kho, bảng giá, payroll; không xóa đơn/khách/tài khoản.
- `sales`: đơn, khách, tồn kho, bảng giá; không payroll và không xóa dữ liệu nhạy cảm.
- `designer`: chỉ cập nhật tiến độ đơn.
- `printing`: chỉ cập nhật tiến độ đơn + tháng làm việc.

Firestore Rules chặn hoàn toàn truy cập trực tiếp từ client; chỉ backend Admin SDK được truy cập.
