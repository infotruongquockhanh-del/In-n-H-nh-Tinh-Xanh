# V30.1 — Khắc phục luồng xử lý lỗi đăng nhập và công cụ sửa quyền Google

## Phạm vi thực tế

Ảnh người dùng cho thấy /api/health V30 trả ok:false. Điều này chứng minh bước kiểm tra đọc DB thất bại, không chứng minh nguyên nhân là IAM, mật khẩu sai hoặc dữ liệu đã mất. Chưa có xác thực Google Cloud trong phiên ChatGPT để sửa quyền/Secrets hoặc Publish AI Studio. Commit GitHub và kiểm thử CI không phải bằng chứng đăng nhập trên website thật đã hoạt động.

## Mã nguồn thay đổi

- Trả lỗi DB có mã rõ ràng: quyền, thông tin xác thực, API bị tắt, database không tồn tại, quá hạn mức, timeout. Thông báo công khai chỉ dùng danh sách có sẵn, không trả khóa, tên project/database hoặc thông báo SDK nguyên văn. Có mã yêu cầu để đối chiếu.
- Lỗi kết nối database không bị đếm thành nhiều lần nhập sai mật khẩu. Health probe gộp các yêu cầu, cache ngắn và có timeout; phục hồi phép kiểm tra khi kết nối hoạt động trở lại.
- Lỗi khởi tạo cấu hình không làm biến mất trang đăng nhập; mọi API dữ liệu vẫn đóng, không tạo DB dự phòng. Tách riêng Firebase app của máy chủ tránh vô tình dùng app đã khởi tạo cho project khác.
- Hỗ trợ FIREBASE_CONFIG dạng JSON/file theo Firebase Admin, nhưng không âm thầm thay database có sẵn: cấu hình mâu thuẫn phải được giải quyết bằng lựa chọn rõ ràng. Giữ nguyên firebase-applet-config.json và data/.
- Không xóa toàn bộ dữ liệu htx_ tại trang đăng nhập. Chỉ bỏ các khóa danh tính cũ; cache không bao giờ được dùng để xác thực. Kiểm tra phiên/phân quyền phía máy chủ và việc xóa cache sau xác thực trong ứng dụng vẫn giữ nguyên.
- Giới hạn thời gian chờ token realtime tùy chọn; việc ký token realtime không được treo toàn bộ lần đăng nhập. Không thay mật khẩu, tự tạo nhân viên hoặc bỏ đăng nhập.

## Sửa cấu hình Google bằng công cụ tại Cloud Shell

Tệp scripts/repair-google-login.py chạy bằng Python 3 và gcloud đã có trong Cloud Shell. Công cụ không yêu cầu người dùng chuyển khóa hoặc mật khẩu vào ChatGPT.

Mặc định chỉ kiểm tra:

```
python3 repair-google-login.py
```

Cho phép thêm duy nhất binding IAM có điều kiện khi đủ bằng chứng:

```
python3 repair-google-login.py --apply-iam
```

Project mặc định là project đã chọn trong gcloud; có thể truyền --project=PROJECT_ID. Chỉ tìm đúng service in-hanh-tinh-xanh, region asia-southeast1, đọc revision đang phục vụ. Không suy đoán project ID từ tên hiển thị đã dịch của Google.

Công cụ xác nhận: một revision phục vụ; service account cụ thể; không dùng khóa xác thực riêng; target cấu hình không mâu thuẫn; có bằng chứng lỗi quyền trong health/logs; database Native có thật; có tài khoản Giám đốc cũ đang hoạt động. Chỉ đọc các trường role/active của users, không lấy hash mật khẩu.

Nếu đáp ứng và chưa thấy binding phù hợp, --apply-iam lưu bản sao policy trong Cloud Shell rồi thêm roles/datastore.user cho service account, giới hạn đúng một database bằng IAM condition. Không cấp Owner/Editor, không thay quyền người vận hành, không export khóa, không đổi Firestore Rules, không tạo database, không khởi tạo tài khoản, không sửa dữ liệu, không nâng cấp thanh toán, không đổi deployment. Sau đó kiểm tra /api/health lại. ok:true chỉ chứng minh đọc DB thành công; người dùng vẫn phải thử đăng nhập bằng mật khẩu thật.

Nếu thiếu quyền Google, Starter Tier không cho phép sửa IAM, thiếu database/tài khoản cũ, cấu hình khác nhau hoặc không có bằng chứng thiếu quyền thì DỪNG và lưu báo cáo HTX-KET-QUA-*.json. Công cụ không thể vượt các giới hạn Google. Chưa đảm bảo giải quyết tất cả nguyên nhân thực tế.

Không cần Publish để chạy công cụ Google. Chạy kiểm tra trên ứng dụng đang lỗi trước; tránh Publish liên tục khi chưa sao lưu dữ liệu. Không coi bản sao IAM policy là bản sao dữ liệu kinh doanh.

## Kiểm thử

CI chạy unit tests, API với DB không khả dụng, xác thực V28, tính giá V29, nghiệp vụ V30 và Chromium. Kiểm thử công cụ IAM dùng mock, không sửa tài khoản Google thật. Bước probe website chỉ GET public /api/health và ghi một số trường trạng thái; không lấy dữ liệu người dùng hoặc thử mật khẩu.

## Tài liệu nền tảng

- https://firebase.google.com/docs/admin/setup
- https://docs.cloud.google.com/firestore/native/docs/manage-databases#configure_per-database_access_permissions
- https://docs.cloud.google.com/firestore/native/docs/security/iam
- https://docs.cloud.google.com/run/docs/configuring/services/service-identity
- https://docs.cloud.google.com/docs/starter-tier
