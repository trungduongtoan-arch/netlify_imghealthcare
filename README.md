# imghealthcarepro

Hồ sơ sức khoẻ và Sổ đo tại nhà của chú Minh và dì Giang, do BS CKI Dương Toàn Trung quản lý. Một project Netlify, địa chỉ https://imghealthcarepro.netlify.app.

- `/` là bảng theo dõi (tổng quan, xu hướng, thuốc, kế hoạch, hồ sơ bệnh án). Tab Tự theo dõi có khung Sổ đo để nhập hộ.
- `/so-do/` là Sổ đo tại nhà: chú và dì nhập huyết áp, cân nặng, đường huyết, triệu chứng, việc đã làm mỗi ngày trên điện thoại.
- `/api/so-do` là hàm của Netlify giữ kho số đo chung. Số nhập trên điện thoại nào cũng hiện ở điện thoại khác của cùng người và ở bảng theo dõi.

## Thư mục

- `site/` các tệp tĩnh đã dựng sẵn, Netlify xuất bản nguyên thư mục này (không có bước build).
- `netlify/functions/so-do.mjs` điểm vào của hàm. `netlify/lib/sodo_core.mjs` toàn bộ logic: xác thực, kiểm tra dữ liệu, ghi và đọc kho.
- `tools/tao_ma_truy_cap.html` trang chạy offline trên máy của BS Trung để sinh mã truy cập và mã băm. Không gửi gì ra mạng.
- `test/` bộ thử của hàm (`npm install` rồi `npm test`).
- `netlify.toml` cấu hình xuất bản.

## Kho số đo hoạt động thế nào

- Mỗi lần bấm Lưu, Sổ đo gửi về hai nơi: kho (Netlify Blobs) và Netlify Forms. Forms là bản dự phòng độc lập; kho chết thì số vẫn về Forms.
- Kho là nhật ký chỉ ghi thêm. Nhập mới, sửa, xoá đều là một dòng mới, không dòng nào bị ghi đè. Hai máy nhập cùng lúc không làm mất số của nhau.
- Mỗi máy nhận về phần nhật ký mới khi mở trang, khi quay lại trang, và cách 2 phút khi trang đang mở. Mất mạng thì số chờ trong máy, có mạng lại tự gửi.
- Quyền truy cập theo mã. Mã của người nào chỉ ghi và đọc được phần của người đó. Mã quản lý chỉ đọc, đọc được cả hai người. Mã nằm trong phần sau dấu `#` của liên kết nên không đi lên máy chủ trong địa chỉ; máy chủ chỉ giữ mã băm SHA-256.
- Quy tắc gộp: bản có số lần sửa cao hơn thắng; xoá thắng và không bị sống lại khi nhận dòng cũ đến muộn; hai máy tick việc khác nhau trong cùng một ngày thì lấy hợp hai danh sách.
- Giới hạn của hàm: mỗi lần gửi tối đa 50 dòng và 40 KB; huyết áp, cân nặng, đường huyết ngoài khoảng hợp lý bị từ chối từng dòng; 120 lượt gọi mỗi phút mỗi địa chỉ IP.

## Cài đặt một lần

1. Tạo mã. Mở `tools/tao_ma_truy_cap.html` bằng trình duyệt trên máy của BS Trung. Bấm Sinh mã. Chép từng mã truy cập vào nơi cất mật khẩu của BS Trung ngay, vì tắt trang là mất.
2. Trên Netlify vào project, Site configuration, Environment variables, tạo các biến sau, phạm vi Functions. Biến có tên bắt đầu bằng SODO_HASH nên đánh dấu secret.

   | Biến | Giá trị |
   |---|---|
   | `SODO_PEOPLE` | `LTM,DTG` |
   | `SODO_HASH_LTM` | mã băm của chú Minh |
   | `SODO_HASH_DTG` | mã băm của dì Giang |
   | `SODO_HASH_ADMIN` | mã băm của mã quản lý |

   Mã băm là dãy 64 ký tự trang tạo mã đã tính sẵn. Mã truy cập (32 ký tự) thì không dán lên Netlify, GitHub hay vào tệp nào trong kho.
3. Forms, Enable form detection (một lần cho project).
4. Site configuration, Build and deploy, Deploy Previews: tắt. Kho dùng chung cho mọi bản triển khai, bản xem trước sẽ đọc và ghi vào số thật.
5. Đẩy kho này lên GitHub, nhánh `main`. Netlify tự triển khai. Sau khi đặt hoặc đổi biến môi trường, triển khai lại một lần để biến có hiệu lực.

## Thử trước khi giao cho chú và dì

1. Thêm người thử: trong trang tạo mã bấm Thêm một người thử (TEST), dán `SODO_HASH_TEST` và đặt `SODO_PEOPLE` thành `LTM,DTG,TEST`, `SODO_PURGEABLE` thành `TEST`. Triển khai lại.
2. Dùng liên kết thử trên hai điện thoại: nhập trên máy này, thấy ở máy kia; sửa, xoá; tắt mạng nhập rồi bật lại.
3. Xoá dữ liệu thử. Mở bảng theo dõi bằng liên kết quản lý trên máy của BS Trung, nhấn F12, tab Console, dán dòng sau:

   ```
   fetch('/api/so-do?person=TEST&confirm=PURGE-TEST', {method: 'DELETE', headers: {Authorization: 'Bearer ' + SODOLOG.getKey('ADMIN')}}).then(r => r.json()).then(console.log)
   ```

   Kết quả có `ok: true` và số dòng đã xoá. Máy chủ chỉ cho xoá người nằm trong `SODO_PURGEABLE`, chú và dì không bao giờ xoá được bằng lệnh này.
4. Gỡ TEST khỏi `SODO_PEOPLE`, xoá `SODO_HASH_TEST` và `SODO_PURGEABLE`, triển khai lại.
5. Gửi liên kết thật: trang tạo mã đã dựng sẵn. Chú và dì mỗi người một liên kết Sổ đo riêng; liên kết hồ sơ riêng (`/#minh.MÃ`) chỉ cho xem phần của chính người đó.

Trên máy anh, mở một lần liên kết quản lý (`/#admin.MÃ`) và liên kết Sổ đo của từng người (`/so-do/#minh.MÃ`): máy nhớ mã, bảng theo dõi đọc số trực tiếp từ kho không cần đồng bộ tệp CSV, và nút Gửi liên kết trong bảng tự gắn mã vào liên kết gửi cho chú dì.

## Đổi mã

Mất điện thoại hoặc lộ liên kết: sinh mã mới cho người đó, thay giá trị `SODO_HASH_<mã người>`, triển khai lại, gửi liên kết mới. Mã cũ hết hiệu lực ngay sau khi triển khai; số đã nhập không mất.

## Theo dõi và sao lưu

- Netlify, Usage: xem số lần đọc và ghi Blobs sau tuần đầu để biết mức dùng thực tế.
- Số đo luôn có một bản trong Netlify Forms. Tải CSV từ Forms theo yêu cầu nếu cần bản ngoài kho.
- Hồ sơ bệnh án nằm trong `site/docs/`. Kho GitHub này phải để riêng tư (private).

## Giới hạn đã biết

- Lần đầu một điện thoại hoặc trình duyệt mới mở liên kết, nó đọc toàn bộ nhật ký của người đó; các lần sau chỉ đọc phần mới.
- Mã nằm trong liên kết nên ai có liên kết là vào được phần của người đó. Đây là lựa chọn có chủ ý để chú và dì không phải đăng nhập; nếu cần chặt hơn thì đổi sang đăng nhập Netlify Identity.

Dựng ngày 2026-11-19.
