# Hành Tinh Xanh V25 — ONLINE + REALTIME + MULTI-USER

Đây là bản chuyển phần mềm từ localStorage/offline sang mô hình dùng chung dữ liệu online.

## Kiến trúc

```text
PC / Điện thoại nhân viên
        │
        ├── HTTPS → Vercel / Express API
        │             │
        │             └── Firebase Admin → Cloud Firestore
        │
        └── Firebase Auth custom token
                      │
                      └── Firestore realtime listeners
```

### Nguyên tắc

- **Cloud Firestore là database chính.**
- `localStorage` chỉ là cache giao diện/offline tạm thời.
- Mỗi đơn hàng/khách hàng/vật tư/sản phẩm tùy chỉnh là một document riêng.
- Frontend không được ghi Firestore trực tiếp.
- Mọi thay đổi ghi qua backend để kiểm tra phân quyền.
- Frontend chỉ đọc Firestore trực tiếp bằng realtime listener.
- Khi nhân viên A cập nhật đơn, nhân viên B đang mở app sẽ nhận snapshot mới gần như ngay lập tức.

## Giải quyết lỗi “tạo đơn nhưng máy khác không thấy”

V25 không còn coi localStorage là dữ liệu chính khi chạy website online.

Nếu website không kết nối backend/database:
- app sẽ báo **Database: không kết nối**;
- không âm thầm chuyển sang dữ liệu local riêng từng máy.

Điều này tránh tình trạng tưởng đã lưu đơn nhưng thực tế chỉ lưu trong browser của một nhân viên.

## Chống ghi đè khi nhiều người cùng sửa

Đơn hàng, khách hàng, tồn kho và sản phẩm tùy chỉnh dùng:
- `version`
- `updatedAt`
- `updatedBy`

Khi lưu, frontend gửi `expectedVersion`.

Nếu người khác đã sửa bản ghi trước đó, backend trả `409 Conflict`, app tải dữ liệu mới và yêu cầu người dùng kiểm tra lại thay vì ghi đè dữ liệu của nhau.

## Cài Firebase

### 1. Tạo Firebase project

Tại Firebase Console:
1. Tạo/ chọn project.
2. Bật **Cloud Firestore**.
3. Bật **Firebase Authentication**.
4. Tạo **Web App** trong Project Settings.

### 2. Deploy Firestore Rules

Dùng file:

`firestore.rules`

Rules V25:
- người đã đăng nhập Firebase mới đọc được dữ liệu realtime;
- payroll chỉ Director/Accounting đọc;
- client không được ghi Firestore;
- tất cả write đi qua backend Firebase Admin.

Có thể deploy bằng Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

## Cấu hình Vercel

Push toàn bộ source lên GitHub, sau đó Import repo vào Vercel.

Vào:

**Vercel → Project → Settings → Environment Variables**

Cấu hình Firebase Admin:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
SESSION_SECRET=chuoi-rat-dai-ngau-nhien
```

Hoặc dùng các credentials tương đương mà Firebase Admin SDK hỗ trợ trong môi trường của bạn.

Cấu hình Firebase Web realtime:

```env
FIREBASE_WEB_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_APP_ID=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_STORAGE_BUCKET=...
```

Nếu dùng Google Sheet:

```env
GOOGLE_SHEETS_WEBAPP_URL=...
GOOGLE_SHEETS_SYNC_SECRET=...
```

Sau đó **Redeploy**.

## Kiểm tra sau Deploy

Mở:

`https://TEN-DOMAIN-VERCEL/api/health`

Phải nhận JSON `ok: true`.

Sau đó mở website và đăng nhập:

```text
giamdoc
123456
```

Ở thanh trên phải thấy:

`Realtime: đang hoạt động`

## Test nhiều nhân viên

### Test 1 — tạo đơn

1. PC A đăng nhập Sale.
2. PC B đăng nhập Giám đốc.
3. Sale tạo đơn.
4. PC B phải thấy đơn mới mà không cần dùng chung browser/localStorage.

### Test 2 — cập nhật trạng thái

1. Designer mở điện thoại.
2. Chuyển đơn sang “Đang thiết kế”.
3. Dashboard trên PC Giám đốc phải tự cập nhật.

### Test 3 — chỉnh đồng thời

1. Hai máy cùng mở một đơn.
2. Máy A lưu thay đổi.
3. Máy B lưu từ phiên bản cũ.
4. Máy B phải nhận cảnh báo dữ liệu đã được người khác cập nhật thay vì ghi đè.

## Dữ liệu Firestore

```text
users/{userId}
orders/{orderId}
customers/{customerId}
inventory/{inventoryId}
customProducts/{productId}

settings/htx_payroll_v17
settings/htx_work_month_v7
settings/htx_price_adjustments_v6
settings/htx_catalog_overrides_v7

auditLogs/{logId}
config/company
config/priceBook
```

## Realtime Authentication

Hệ thống vẫn cho nhân viên đăng nhập bằng username/password hiện tại.

Luồng:

```text
username/password
       ↓
Vercel backend kiểm tra Firestore users
       ↓
Firebase Admin tạo custom token có role
       ↓
Frontend signInWithCustomToken()
       ↓
Firestore realtime listeners hoạt động
```

Firebase hỗ trợ custom tokens chính thức cho trường hợp tích hợp hệ thống đăng nhập riêng.

## Vercel

`server.js` export Express app trực tiếp để Vercel chạy dưới dạng Function.

Khi chạy local:

```bash
npm install
npm start
```

Khi chạy Vercel:
- không cần VPS;
- không cần tiến trình server riêng;
- Vercel chạy backend function.

## Google Sheet

Bản V23/V24 Google Sheet sync vẫn được giữ.

Firestore là database chính.
Google Sheet chỉ dùng mirror/report/backup.


## V26 — Session bền vững + trang chủ Đơn sản xuất + xác nhận lưu database

- F5 không còn tự văng đăng nhập: session cookie được gia hạn và có cơ chế khôi phục từ Firebase Auth local persistence.
- Sau đăng nhập hoặc F5, trang mặc định luôn là **Đơn sản xuất**.
- Nút **LƯU ĐƠN** chỉ báo thành công sau khi backend/Firestore xác nhận lưu.
- Đơn bị mất mạng sẽ vào hàng chờ và được retry khi online/focus lại.
- Sau khi lưu thành công, app hydrate lại dữ liệu để nhận version mới nhất và tránh ghi đè khi nhiều nhân viên cùng sửa.
- Service Worker dùng network-first cho HTML/navigation để tránh app bị kẹt ở source cũ sau deploy.
