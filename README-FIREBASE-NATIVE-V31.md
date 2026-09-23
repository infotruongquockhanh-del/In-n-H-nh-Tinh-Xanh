# Hành Tinh Xanh V31 — Firebase Native cho Google AI Studio Starter Tier

V31 bỏ Firebase Admin SDK khỏi đường chạy production. Cloud Run chỉ phục vụ HTML/JS. Trình duyệt dùng Firebase Authentication (Google Sign-In) và Firestore Web SDK trực tiếp vào đúng database đã có trong firebase-applet-config.json.

## Vì sao cách này sửa DB_PERMISSION_DENIED

V30 dùng Application Default Credentials của service account Cloud Run. Starter Tier quản lý IAM nên service account này có thể không có quyền Firestore. V31 không dùng service account Cloud Run cho dữ liệu; mỗi người dùng Firebase Auth truy cập Firestore theo firestore.rules.

## Đăng nhập

Không còn form tài khoản/mật khẩu nội bộ. Nếu trình duyệt chưa có phiên Firebase, ứng dụng tự chuyển qua Google Sign-In một lần rồi quay lại website. Hai email chủ sở hữu hiện được phép bootstrap vai trò Giám đốc:
- inhanhtinhxanh@gmail.com
- info.truongquockhanh@gmail.com

Giám đốc cấp quyền nhân viên bằng email Google trong trang Tài khoản & phân quyền. Nhân viên đăng nhập Google bằng đúng email đó và nhận role tương ứng.

## Dữ liệu

Giữ nguyên database ID: ai-studio-innhnhtinhxanh-7678140b-9310-430e-aca2-4ac9c52f1af2.
Không tạo database mới, không chuyển về local file, không xóa dữ liệu cũ.
Orders/customers/inventory/customProducts/settings dùng lại collection hiện tại.

## Google AI Studio

Trong Settings > Integrations, bật Firebase Firestore & Auth cho app hiện tại và chọn đúng project/database hiện có. Google AI Studio hỗ trợ Firebase Web SDK + Firestore Security Rules trên Starter Tier. Sau đó Pull nhánh main và Publish app hiện tại. Khi Publish, kiểm tra firestore.rules được deploy.

## Vercel

Vercel không còn cần thiết để truy cập Firestore của website AI Studio. Có thể dùng sau này làm bản preview/backup deployment, nhưng không được dùng làm nguồn dữ liệu thứ hai để tránh lệch dữ liệu.
