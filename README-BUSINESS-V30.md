# Hành Tinh Xanh V30 — cm/m², tiền còn phải thu, KPI và bảo toàn dữ liệu

## Chưa xuất bản lên website

Bản sửa này cần kiểm thử trên nhánh fix/v30-area-kpi-data và đối chiếu dữ liệu thật trước khi triển khai. GitHub/ZIP không phải bằng chứng website đã cập nhật hoặc dữ liệu đang chạy đã được sao lưu. Nhánh backup/pre-v30-20260922 chỉ giữ mã nguồn V29; file data/ trong repo có thể khác dữ liệu website. Không thay đổi file data/ trong bản sửa.

**Không Publish đè bản đang chạy khi chưa xuất dữ liệu thật ra nơi an toàn và xác nhận đúng cơ sở dữ liệu bền vững.** V30 có thể từ chối khởi động môi trường cũ đang dùng local DB tạm: mục đích là không âm thầm mở một DB rỗng rồi lưu nhầm.

## Hạng mục khác

Đơn vị Cái / Tấm / Tờ / m², ngang/cao bằng cm, số bản/tấm là số nguyên dương. Diện tích mỗi bản = ngang × cao / 10.000. Tổng diện tích = diện tích mỗi bản × số bản. Chọn m² thì nhân tổng diện tích với đơn giá/m²; Cái/Tấm/Tờ thì nhân số lượng, không nhân thêm diện tích. Ví dụ 100×100cm, một bản, 100.000đ/m² = 100.000đ; 60×90cm, ba bản = 1,62m² = 162.000đ với cùng đơn giá.

Giữ cách nhập tổng tiền để chia ngược đơn giá; không làm tròn đơn giá rồi nhân ngược gây lệch. Số mặt in vẫn chọn 1/2, không tự nhân đôi giá. Lưu kích thước cm, số bản, diện tích, đơn giá và tổng theo từng dòng. Dòng m² cũ giữ nguyên giá đã lưu; khi mở sửa phải xác nhận kích thước/số bản nếu dữ liệu cũ chưa có.

## Đơn sản xuất

Hiển thị rõ CÒN PHẢI THU, Tổng đơn và Đã thu/cọc. Còn phải thu = max(0, tổng đơn − tiền đã thu), không trừ cọc hai lần; đã thu đủ thì bằng 0. Khi tăng tổng của đơn đã thu đủ, giữ số tiền thực đã thu trước đó và hiển thị chênh lệch cần thu. Các số đã lưu trên đơn cũ không bị tính giá mới chỉ vì cập nhật phần mềm.

## Phí thiết kế và khoản tính vào lương

Phí thu khách = số sản phẩm thiết kế × 40.000đ. Số mẫu/sản phẩm thiết kế nhập riêng, không suy từ số bản in. Một thiết kế in 1.000 bản vẫn là một sản phẩm thiết kế. Đơn cũ giữ phí cũ; không tự sửa doanh thu lịch sử.

KPI ghi nhận khi xác nhận thiết kế hoàn thành, cho nhân viên được phân công, theo tháng hoàn thành giờ Việt Nam. Mỗi đơn có một bản ghi hoàn thành duy nhất; thay tiến độ/giao hàng không cộng lại. Nhân viên thiết kế chỉ xác nhận đơn của mình. Giám đốc/Kế toán có thể xác nhận ngày thực tế trong quá khứ. Đơn cũ cần xác nhận số sản phẩm và phí phù hợp trước khi ghi KPI; số lượng đã xác nhận không tự thay đổi lương lịch sử.

| Số sản phẩm | Trạng thái | Khoản thiết kế/KPI tính vào lương |
|---|---|---|
| 60 | Không đạt KPI | 60 × 5.000 = 300.000đ, không thưởng thêm |
| 100 | Đạt KPI | 1.000.000đ |
| 150 | Đạt KPI | 1.500.000đ |
| 200 | Đạt KPI | 2.000.000đ |

**Cần chủ doanh nghiệp xác nhận số giữa các mốc và trên 200:** mặc định theo mốc: 100–149 = 1 triệu; 150–199 = 1,5 triệu; từ 200 = 2 triệu. Giám đốc có lựa chọn thay thế “Từ 100: 10.000đ/sản phẩm” để 125 = 1.250.000đ hoặc 220 = 2.200.000đ. Dưới 100 luôn 5.000đ/sản phẩm. Hai quy tắc thay thế nhau, không cộng dồn. Phí thu khách 40.000đ không phải đơn giá trả lương thiết kế.

Lương & Chấm công → chọn nhân viên thiết kế → Cập nhật KPI theo đơn hoàn thành. Máy chủ tính và lưu snapshot gồm số sản phẩm, trạng thái, quy tắc, số tiền; cộng đúng một lần vào công thức lương hiện có. Phiếu cũ không tự thay đổi khi phát sinh thêm đơn hoặc đổi quy tắc; muốn tính lại phải cập nhật KPI và lưu. Phiếu in thể hiện số sản phẩm và Đạt/Không đạt. Không thay đổi công thức BHXH/ngày công hiện có trong đợt này.

## Khách hàng và liên kết đơn

Hàm hiển thị trang Khách hàng không còn tạo hoặc ghi hồ sơ. Máy chủ tạo/liên kết khách cùng giao dịch lưu đơn và giữ customerId ổn định. MST/điện thoại/email/CCCD dùng đối chiếu; thông tin mâu thuẫn không gộp. Đơn có customerId không đổi liên kết khi đổi trạng thái.

Hồ sơ trùng cũ không tự xóa. Giám đốc có Kiểm tra hồ sơ trùng, xem nhóm rồi xác nhận; hồ sơ phụ được lưu trữ với mergedInto (không xóa vĩnh viễn), lưu bản trước trong lịch sử, nối đơn về hồ sơ chính. Không gộp chỉ vì giống tên. Khách đang có đơn không được xóa làm đứt liên kết.

## Bảo toàn dữ liệu trong mã nguồn

- Bỏ cắt danh sách còn 300 đơn và bỏ âm thầm cắt hàng đợi.
- Danh sách gửi lên thiếu bản ghi không làm xóa bản ghi đang có. Xóa phải là thao tác riêng có quyền.
- Kiểm tra version chính xác, kể cả hai tab cùng tài khoản; dữ liệu cũ không ghi đè bản mới. Lưu lương theo từng nhân viên/tháng thay vì ghi đè mọi tháng.
- Lưu bản trước/dấu xóa trong dataHistory cùng giao dịch thay đổi. Đây là lịch sử cùng DB, không thay sao lưu độc lập nếu cả DB bị xóa.
- Thay đổi đơn/khách/kho qua bộ đồng bộ có hàng đợi mã hóa AES-GCM, giữ qua F5/đăng xuất; cùng tài khoản xác thực mới đọc lại. Hiển thị CHƯA LƯU, cho tải bản nháp/thử lại; xung đột không tự ghi đè. Form chưa bấm lưu, hết dung lượng hoặc xóa dữ liệu trình duyệt, mất khóa máy chủ vẫn có thể làm mất bản nháp; không coi là backup dài hạn.
- Không báo đơn đã lưu nếu API thất bại; không lấy Sheet cũ ghi đè DB. Không reset dữ liệu vì thiếu marker; chỉ tạo cấu hình chưa tồn tại.
- Cloud Run/Vercel/production mặc định Firestore; không tự chuyển sang file local khi credentials sai/thiếu. Hỗ trợ Application Default Credentials của service account Cloud Run. Phải cấu hình đúng FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID và quyền; không trỏ sang DB rỗng rồi coi như đã di chuyển dữ liệu.
- DATA_BACKEND=local không được dùng trên Cloud Run/Vercel. Máy chủ tự quản lý có ổ bền vững mới dùng local production với HTX_LOCAL_DB_PATH và HTX_LOCAL_DURABLE=true. File local ghi tạm/fsync/đổi tên nguyên tử và có .previous trên cùng ổ, không phải backup ngoài máy.

## Lấy dữ liệu cũ trước khi cập nhật

Trên website cũ, đăng nhập Giám đốc rồi mở /api/state trên cùng tên miền; chỉ lưu JSON khi phản hồi có state và dữ liệu đơn/khách/giá/lương đúng. Không lưu trang lỗi đăng nhập như backup. Giữ thêm dữ liệu chờ đồng bộ/bản nháp tại máy nhập liệu. /api/state chỉ chứa dữ liệu API trả về, không thay export toàn bộ DB/tệp/tài khoản/khóa máy chủ.

Chuyển JSON cũ ngoại tuyến:

```
node scripts/convert-legacy-state.mjs state-from-old-site.json business-backup.json
```

Script không kết nối DB, không đổi file gốc, không đưa mật khẩu vào backup. Sau khi cấu hình đúng DB, nút TẢI BẢN SAO DỮ LIỆU ở Tài khoản xuất bảng kinh doanh và lịch sử, checksum SHA-256, số bản ghi; không chứa mật khẩu, session secret hoặc khóa dịch vụ. Đối chiếu/khôi phục chỉ thêm bản ghi thiếu sau xác nhận, không ghi đè bản đang tồn tại. Nội dung xung đột được giữ để đối chiếu. Restore nhiều bản ghi có thể chạy lại; lỗi giữa chừng phải đối chiếu lại, không coi là đã xong.

Cần export toàn bộ DB độc lập (gồm users/cấu hình) qua Google Cloud/Firestore, lưu riêng với quyền truy cập phù hợp; bật backup định kỳ/PITR và thử khôi phục thực tế. Không đưa khóa/mật khẩu lên repo. Source V30 không tự bật dịch vụ backup Google Cloud.

## Kiểm thử và phạm vi

Workflow business-v30 chạy source migration, kiểm tra cú pháp, auth V28, giá V29, phép tính V30, tính nguyên vẹn DB và Chromium: cm/m², thu còn lại, khách duy nhất, phí thiết kế/KPI, hàng đợi qua F5, hơn 300 đơn, xuất backup, điện thoại. Tất cả dùng DB tạm. CI/local không chứng minh Firestore thật, sao lưu định kỳ hoặc bản Publish AI Studio đã hoạt động. Các yêu cầu SESSION_SECRET/Firestore rules ở V28 vẫn áp dụng.
