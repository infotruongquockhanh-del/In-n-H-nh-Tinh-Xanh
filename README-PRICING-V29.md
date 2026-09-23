# Hành Tinh Xanh V29 — Giá theo số mặt và Hạng mục khác

## Giao diện đã gọn lại

Bỏ khối cấu hình/đồng bộ Google Sheet và dòng tóm tắt phân quyền trong trang Tài khoản; bỏ biểu đồ Dòng tiền tháng đang chọn; bỏ ngày hiện tại và ô tháng làm việc bị lặp trên thanh đầu trang. Giữ bảng quản lý tài khoản, quyền Giám đốc, dữ liệu kinh doanh, API đồng bộ và bộ chọn tháng ở Tổng quan. Không xóa cấu hình Google Sheet đang có và không xóa doanh thu/công nợ.

## Thêm hạng mục và bảng giá cố định

Vào Bảng giá & hạng mục → Thêm hạng mục mới. Mỗi quy cách có giá cơ bản, chọn số mặt của giá cơ bản và hai ô giá in 1 mặt/in 2 mặt riêng. Có thể dùng đơn vị, tấm hoặc m². Để trống mức giá chưa có; giá 0 chỉ được dùng khi nhập rõ 0.

Với bảng có sẵn, bấm Chi tiết & giá. Cột Giá hiện tại áp dụng cho dùng để xác định giá cũ là giá 1 mặt hay 2 mặt. Có nút áp dụng phân loại cho mọi dòng trong bảng. Hai cột giá theo số mặt cho phép nhập riêng từng mức. Giá riêng được ưu tiên hơn giá cơ bản. Chưa khai báo giá đúng số mặt/quy cách/số lượng thì không được thêm vào báo giá; không tự nhân đôi hoặc chia đôi.

Giá cũ chưa có thông tin số mặt được giữ ở chế độ Chưa phân loại số mặt. Không tự đoán số mặt của dữ liệu này. Các dòng vốn đã ghi rõ số mặt trong source được giữ nguyên. Công thức phụ phí khung cửa lò xo cũ được giữ cho đúng hai kích thước đã có. Giá in và số mặt cán màng là hai thông số khác nhau.

Tên danh mục menu tấm đổi từ In menu 2 mặt thành In menu tờ / tấm để không gây nhầm khi báo giá 1 mặt. Các mã sản phẩm cũ không thay đổi.

## Hạng mục khác

Trong Tạo báo giá chọn Hạng mục khác. Nhập chất liệu, chọn In 1 mặt hoặc In 2 mặt, kích thước tự do, số lượng và đơn vị tính, loại gia công, ghi chú kỹ thuật. Có thêm tên hạng mục tùy chọn để tên in trên báo giá rõ ràng.

Nhập đơn giá để tự tính tổng; nhập trực tiếp tổng tiền để tự chia ra đơn giá. Ô giá vừa sửa quyết định chiều tính. Số lượng chấp nhận phần thập phân. Tổng tiền làm tròn đến 1 đồng; tổng đã nhập không bị tính ngược từ đơn giá đã làm tròn. Số mặt in không tự nhân đôi giá thủ công. Hệ số bảng giá không tự áp dụng vào Hạng mục khác.

Quy cách, số mặt, loại gia công, ghi chú, chế độ nhập giá, đơn giá và tổng tiền được lưu theo từng dòng báo giá. Khi mở sửa lại đơn hoặc dòng hạng mục, dữ liệu nhập tay được giữ lại. Bản in và Excel có đầy đủ thông số; số lượng thập phân và đơn giá chia từ tổng không bị ép về số nguyên trong dữ liệu xuất.

## Kiểm thử và triển khai

Workflow pricing-v29 kiểm tra mã, phép tính, đăng nhập/phân quyền V28, giao diện PC/điện thoại, bảng giá cố định, hạng mục tự tạo, lưu/mở lại đơn, bản in và Excel. Mọi dữ liệu kiểm thử dùng cơ sở dữ liệu tạm; không dùng dữ liệu website đang chạy.

Các thay đổi mới ở public/quote-math.js, public/quote-v29.js và public/app.html. Script scripts/upgrade-pricing-v29.py ghi lại chuyển đổi V28 sang V29 và có thể chạy lại an toàn. Source đã kiểm thử đã được chuyển đổi; không cần dán từng đoạn code.

Commit lên GitHub KHÔNG đồng nghĩa website in-hanh-tinh-xanh.ai.studio đã được Publish. Lấy đúng nhánh main vào dự án AI Studio và cập nhật ứng dụng hiện có. Không xóa/Unpublish dự án. Sao lưu dữ liệu thực tế trước khi cập nhật, đặc biệt nếu đang dùng local database trong container. ZIP mã nguồn không phải bản sao lưu dữ liệu đang chạy. Phần đăng nhập và yêu cầu SESSION_SECRET/Firestore rules của README-AUTH-V28.md vẫn áp dụng; V29 không sửa cấu hình xác thực.
