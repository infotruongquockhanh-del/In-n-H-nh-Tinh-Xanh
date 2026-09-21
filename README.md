# Hành Tinh Xanh Full-stack V22

Bộ code này được chuẩn bị để đưa lên **Google AI Studio Build** / GitHub và chạy dưới dạng ứng dụng full-stack.

## Kiến trúc

- **Frontend:** HTML/CSS/JavaScript responsive + PWA trong `public/app.html`.
- **Backend:** Node.js + Express trong `server.js`.
- **Database:** Google Cloud Firestore qua Firebase Admin SDK.
- **Authentication:** Backend session cookie HttpOnly; tài khoản/role lưu trong Firestore.
- **Offline:** localStorage vẫn là cache/fallback. Khi chạy qua backend, dữ liệu được đồng bộ Firestore.
- **PWA:** manifest + service worker + icon, có thể cài trên PC/mobile.

## Tài khoản mặc định

- Username: `giamdoc`
- Password: `123456`

Backend chỉ tạo tài khoản mặc định ở lần khởi tạo database đầu tiên. Sau đó hãy đổi mật khẩu.

## Chạy local

1. Tạo Firebase project + Firestore.
2. Tạo service account hoặc dùng Application Default Credentials.
3. Copy `.env.example` thành `.env`.
4. Cài và chạy:

```bash
npm install
npm start
```

Mở `http://localhost:8080`.

## Đưa vào Google AI Studio

Cách ổn định nhất là đưa thư mục này lên GitHub trước.

Trong Google AI Studio:
1. Vào **Build**.
2. Chọn **Add files (+) → Import from GitHub**.
3. Chọn repo chứa code này.
4. Vào Firebase/Integrations và liên kết project Firestore.
5. Tạo server-side secret `SESSION_SECRET` (ít nhất 32 ký tự ngẫu nhiên).
6. Yêu cầu agent đọc `AI_STUDIO_PROMPT.txt`, kiểm tra build và Firebase permissions.
7. Publish lên Cloud Run.

## Đồng bộ dữ liệu

Frontend giữ giao diện và nghiệp vụ V21/V22. Mỗi thay đổi dữ liệu chính được mirror lên backend:
- đơn hàng
- khách hàng
- tài khoản
- tồn kho
- sản phẩm tùy chỉnh
- payroll
- tháng làm việc
- điều chỉnh/override bảng giá

Backend lưu các thực thể chính thành collection Firestore riêng, thay vì chỉ lưu một blob lớn.

## Bảo mật

- Cookie phiên đăng nhập là HttpOnly.
- Firestore Rules mặc định `deny all` với client.
- Chỉ backend Admin SDK truy cập database.
- Backend kiểm tra role trước khi ghi.
- Chỉ Giám đốc được phép xóa đơn/khách/tài khoản ở tầng server.

## Các file quan trọng

- `public/app.html`: frontend đầy đủ.
- `server.js`: API + static server.
- `src/auth.js`: đăng nhập/session.
- `src/state-store.js`: database + phân quyền.
- `src/firebase-admin.js`: kết nối Firebase.
- `data/price-book.json`: 17 bảng giá gốc.
- `firestore.rules`: security rules.
- `DATABASE_SCHEMA.md`: sơ đồ database.
- `AI_STUDIO_PROMPT.txt`: prompt dùng ngay sau khi import vào AI Studio.


## Google Sheet + Apps Script Sync V23

Thư mục `apps-script/` chứa code Google Apps Script để mirror dữ liệu Firestore sang Google Sheet.

Cấu hình hai server-side secret:
- `GOOGLE_SHEETS_WEBAPP_URL`
- `GOOGLE_SHEETS_SYNC_SECRET`

Xem hướng dẫn đầy đủ tại `apps-script/README.md`.

Tài khoản/passwordHash không được đồng bộ sang Sheet.


## V24 — Sửa lỗi không cuộn được bằng chuột / mobile

Đã loại bỏ cơ chế khóa `body.style.overflow = "hidden"` khi mở menu mobile.

Thay đổi:
- `html` và `body` luôn cho phép `overflow-y: auto`;
- `erp-shell`, `workspace`, `page-host` không còn vô tình khóa chiều cao/scroll;
- sidebar có vùng cuộn riêng;
- thêm `ensureAppScrollUnlocked()` để tự phục hồi nếu trình duyệt còn giữ `overflow:hidden`;
- phục hồi scroll khi resize, focus, pageshow và quay lại tab;
- vẫn giữ overlay/menu mobile nhưng không khóa wheel của app.

Kết quả:
- PC: lăn con lăn chuột để cuộn trang bình thường.
- Trackpad: cuộn dọc bình thường.
- Mobile: vuốt lên/xuống bình thường.


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
