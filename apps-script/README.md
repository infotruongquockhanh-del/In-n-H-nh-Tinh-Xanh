# Google Sheet + Apps Script Sync — Hành Tinh Xanh V23

## Thiết lập nhanh

1. Tạo một Google Sheet mới.
2. Vào **Extensions → Apps Script**.
3. Dán `Code.gs`.
4. Chạy một lần:

```javascript
setupGoogleSheet("HTX-SECRET-RAT-DAI-CUA-BAN-2026");
```

Secret nên dài ít nhất 16 ký tự và khó đoán.

5. **Deploy → New deployment → Web app**.
6. Copy Web App URL dạng `https://script.google.com/macros/s/.../exec`.
7. Trong Google AI Studio / Cloud Run thêm server-side secrets:

```env
GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/.../exec
GOOGLE_SHEETS_SYNC_SECRET=HTX-SECRET-RAT-DAI-CUA-BAN-2026
```

Hai secret phải giống nhau.

## Các Sheet được tạo tự động

- DON_HANG
- KHACH_HANG
- TON_KHO
- SAN_PHAM_TUY_CHINH
- LUONG_CHAM_CONG
- THANG_LAM_VIEC
- DIEU_CHINH_GIA
- GIA_CHI_TIET
- NHAT_KY_DONG_BO

## Cơ chế đồng bộ

- Firestore vẫn là database chính.
- Khi phần mềm ghi dữ liệu, backend ghi Firestore trước rồi mirror sang Google Sheet.
- Nếu Apps Script lỗi, Firestore vẫn lưu thành công.
- Giám đốc có thêm nút:
  - Đẩy toàn bộ lên Sheet
  - Lấy dữ liệu từ Sheet
  - Kiểm tra kết nối

## Lưu ý quan trọng khi chỉnh trực tiếp trên Sheet

Mỗi dòng có cột `JSON_DATA`. Khi kéo dữ liệu từ Sheet về phần mềm, hệ thống dùng `JSON_DATA` để khôi phục đầy đủ object.

Vì vậy nếu chỉ sửa cột hiển thị như `PHI_SHIP`, `VAT`, `TONG_DON` mà không sửa `JSON_DATA`, giá trị kéo về sẽ vẫn theo `JSON_DATA`.

Bản này ưu tiên:
- xem báo cáo;
- backup;
- đồng bộ hai chiều ở cấp object đầy đủ.

## Bảo mật

- Không đồng bộ `passwordHash` tài khoản sang Sheet.
- Secret chỉ nằm trong Apps Script Properties và backend Secrets.
- Không đặt secret trong HTML/frontend.
