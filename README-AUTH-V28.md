# Hành Tinh Xanh — V28: Đăng nhập bắt buộc và tài khoản do Giám đốc cấp

## Hành vi đã sửa

- Trang `/`, `/index.html`, `/login` là trang đăng nhập. Không có đăng nhập nhanh theo vai trò, mật khẩu mặc định hiển thị hay đăng ký tài khoản công khai.
- Chỉ tài khoản Giám đốc hiện có và tài khoản do Giám đốc cấp trên máy chủ mới được đăng nhập. Các tài khoản nhân viên cũ chưa có dấu xác nhận cấp quyền được giữ nguyên nhưng không được truy cập. Giám đốc có thể cấp lại quyền và đặt mật khẩu mới trong **Tài khoản & phân quyền**; không tự xóa hồ sơ nhân viên hoặc dữ liệu kinh doanh.
- Giám đốc tạo tài khoản gồm họ tên, tên đăng nhập, mật khẩu tối thiểu 8 ký tự và vai trò. Chỉ thông báo tạo thành công sau khi máy chủ đã lưu.
- Đường dẫn `/app.html` và API dữ liệu kiểm tra phiên tại máy chủ. Không dùng vai trò, mật khẩu hoặc token trong localStorage để xác thực. Đăng nhập sai không mở ứng dụng.
- Bỏ hoàn toàn phiên Giám đốc tạm không cần mật khẩu. Khóa tài khoản, đổi mật khẩu, đổi quyền, xóa tài khoản và đăng xuất làm vô hiệu hóa phiên cũ. Đăng xuất hiện vô hiệu hóa các phiên web của cùng tài khoản trên những thiết bị khác.
- Khi đang ở ứng dụng và phiên vẫn hợp lệ, F5 tiếp tục sử dụng phiên đã xác thực; khi mở trang chủ vẫn hiển thị form đăng nhập.
- Bảng phân quyền giao diện hiện có được giữ lại; dữ liệu lương và quyền quản lý tài khoản được kiểm tra thêm phía máy chủ. Không gửi hash mật khẩu xuống trình duyệt, kể cả cho Giám đốc.

## Tài khoản Giám đốc và mật khẩu

Không tự thay đổi hoặc đặt lại mật khẩu Giám đốc hiện có trong cơ sở dữ liệu. Mật khẩu cũ hợp lệ vẫn được xác thực; tài khoản dùng mật khẩu mặc định hoặc ngắn hơn 8 ký tự phải đổi mật khẩu trước khi vào phần mềm. Mật khẩu mới được lưu bằng scrypt có salt riêng.

Đối với cài đặt mới CHƯA có bất kỳ Giám đốc nào, người quản trị máy chủ phải đặt `BOOTSTRAP_DIRECTOR_PASSWORD` (8–128 ký tự) và có thể đặt `BOOTSTRAP_DIRECTOR_USERNAME` (mặc định tên đăng nhập là `giamdoc`). Không có mật khẩu khởi tạo dùng chung. Không đưa giá trị mật khẩu hoặc khóa bí mật vào GitHub.

## Việc phải làm trước khi cập nhật website đang chạy

1. Sao lưu cơ sở dữ liệu thực tế trước khi xuất bản lại. Bản sửa không sửa các file `data/` trong repo và không xóa đơn hàng/khách hàng; tuy nhiên, nếu website đang ghi vào file local trong container, dữ liệu chạy thực tế có thể không trùng file trong repo. Không xem source ZIP là bản sao lưu dữ liệu đang chạy.
2. Cấu hình `SESSION_SECRET` riêng, ngẫu nhiên, ít nhất 32 ký tự trong Secrets/biến môi trường của dịch vụ. Không dùng khóa mẫu cũ. Nếu thiếu, ứng dụng dùng khóa ngẫu nhiên riêng cho mỗi tiến trình; phiên có thể mất khi khởi động lại hoặc khi chuyển giữa nhiều instance.
3. Xuất bản `firestore.rules` V28 vào ĐÚNG project và database đang dùng, theo cấu hình `firebase.json`. File này ngăn token Firebase cũ hoặc tài khoản đã bị khóa/chưa được cấp quyền đọc dữ liệu trực tiếp. Chỉ cập nhật code website KHÔNG chứng minh rules đã được áp dụng trên Firebase.
4. Lấy bản code mới từ GitHub vào đúng dự án AI Studio đang sử dụng và xuất bản/cập nhật ứng dụng hiện có. Việc commit GitHub không tự chứng minh đường dẫn `in-hanh-tinh-xanh.ai.studio` đã cập nhật. Không xóa/Unpublish dự án để cập nhật.
5. Kiểm tra cửa sổ riêng tư: trang chủ là đăng nhập; đăng nhập sai bị từ chối; Giám đốc đăng nhập, đổi mật khẩu nếu được yêu cầu, tạo thử tài khoản nhân viên; kiểm tra quyền và đăng xuất. Phiên cũ trước V28 không còn được chấp nhận.

Không cần cấp quyền tạo tài khoản hoặc đổi quyền cho Kế toán, Kinh doanh, Thiết kế hoặc In ấn. Các quyền này luôn thuộc Giám đốc ở máy chủ.

## Kiểm thử và phạm vi xác minh

- `npm install` rồi `npm test`: kiểm thử xác thực/phân quyền bằng API với cơ sở dữ liệu tạm, không sử dụng dữ liệu website thật.
- Workflow `.github/workflows/auth-v28.yml` còn chạy Chromium: trang đăng nhập, bộ nhớ giả, sai mật khẩu, đăng nhập Giám đốc, F5, tạo nhân viên, phân quyền menu, đăng xuất và màn hình điện thoại.
- `scripts/upgrade-auth-v28.mjs` ghi lại thao tác chuyển đổi mã nguồn V27 sang V28. Các file HTML/server trong bản đã kiểm thử đã được cập nhật; script có kiểm tra dấu phiên bản để không áp dụng chuyển đổi hai lần.
- Kiểm thử không xác nhận dịch vụ AI Studio hoặc Firestore rules trên môi trường thật đã được triển khai. Cấu hình dịch vụ thật, khả năng lưu bền vững, quản trị Secrets và xuất bản rules phải được kiểm tra tại môi trường Google đang chạy.

Các tài liệu V22/V25/V27 trước đây chỉ dùng để tham khảo lịch sử. Với đăng nhập và tài khoản, áp dụng hướng dẫn V28 này.
