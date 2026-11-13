# Kết nối Muse → dashboard Team Aptis Kỳ Tích

Muse đọc group Facebook bằng tài khoản Thiện, rồi tự ghi kết quả lên dashboard. Dữ liệu đi thẳng lên DB dashboard (Supabase), không qua máy Mac.
Muse chỉ **ghi** được, không đọc, sửa hay xoá gì. Bot quét group trên máy vẫn chạy song song.

## Địa chỉ (gọi REST, cách chính)

Mỗi lần gọi: `POST`, `Content-Type: application/json`, body `{"items": [ ... ]}`, tối đa 50 mục mỗi lần.

| Việc | Địa chỉ |
|---|---|
| Bài cần trả lời | `https://jnlklvsuaqwizlohiknx.supabase.co/rest/v1/rpc/muse_them_bai_can_tra_loi` |
| Review đề | `https://jnlklvsuaqwizlohiknx.supabase.co/rest/v1/rpc/muse_them_review` |
| Lắng nghe | `https://jnlklvsuaqwizlohiknx.supabase.co/rest/v1/rpc/muse_them_lang_nghe` |

Mỗi lần gọi gửi 2 header:
- `apikey`: anon key công khai của dashboard. Thiện bấm "Chép" ở Cài đặt → Kết nối Muse.
- `x-muse-key`: mã kết nối Muse. Thiện tự tạo và tự dán, xem mục dưới.

Kết quả trả về luôn có dạng `{"da_them": N, "trung_bo_qua": M, "loi": [{"muc": số thứ tự, "loi": "lý do"}]}`.
- Mục nào lỗi thì bị bỏ, các mục khác vẫn ghi.
- Mã sai hoặc đã thu hồi: trả lỗi "Mã kết nối sai hoặc đã bị thu hồi".
- Quá 200 lần gọi trong 1 giờ: trả lỗi.

## Cách Thiện lấy mã (tự làm một mình)

1. Đăng nhập dashboard bằng tài khoản Thiện, vào tab **Cài đặt**, mục **🤖 Kết nối Muse**. Mục này chỉ tài khoản Thiện thấy.
2. Bấm **Tạo mã**. Mã hiện đúng 1 lần; bấm **Chép mã** rồi dán vào Muse làm header `x-muse-key`.
3. Bấm **Đã dán vào Muse, ẩn mã**.

Thêm về mã:
- DB chỉ lưu mã băm, nên không ai xem lại được mã thật.
- Tạo mã mới thì mã cũ ngừng chạy ngay.
- **Thu hồi mã** thì Muse dừng ghi cho tới khi tạo mã mới.
- Ở mục đó Thiện xem được mã đang dùng (4 ký tự cuối), lần Muse dùng gần nhất và 10 lần gọi gần đây.
- Không gửi mã qua chat, Zalo, Telegram hay file.

## 3 tool (để viết prompt cho Muse)

Link luôn phải là permalink `https://www.facebook.com/groups/<mã group>/posts/<mã bài>/`. Link có đuôi `?comment_id=…`, dạng `/permalink/`, hoặc dạng tên rút gọn của group (vd `groups/hoireviewdeaptis/...`) vẫn nhận. Hệ thống tự đổi về dạng số chuẩn.
Chống trùng theo **mã bài** (số sau `/posts/`): cùng 1 bài ở 2 dạng link, Muse hay bot ghi trước, đều chỉ tính 1 lần. Lệnh bot `targets` cũng đã đổi theo cách này. Gặp group mới có tên rút gọn thì thêm 1 dòng vào bảng `fb_group_alias`.

### 1. Bài cần trả lời: `muse_them_bai_can_tra_loi`

Mỗi mục: `{ "url", "question", "angle" }`
- `question`: nội dung bài nguyên văn. Che tên người, SĐT, email bằng `[...]`, không ghi tên người đăng.
- `angle`: 1 câu gợi ý trả lời, có thể bỏ trống.

Cách hệ thống xử lý:
- Chỉ nhận bài ở 2 group "Key Aptis miễn phí - update liên tục" và "Hội review đề Aptis có tâm", nhận ra theo mã group trong link. Group khác thì báo lỗi.
- Bài trùng link với bài đã có (kể cả bài bot trên máy đã ghi) thì bỏ qua.
- Tự chia người giống lệnh bot `targets`: ai đang ôm ít bài mở nhất được giao trước, theo tỉ lệ ở ô "cmt/ngày" trong tab Cài đặt.
- Bài ghi từ Muse được đánh nguồn `muse`.

### 2. Review đề: `muse_them_review`

Mỗi mục: `{ "url", "group", "posted_at", "exam_date", "shift", "location", "content" }`
- `posted_at` theo dạng dd/mm HH:MM, giờ Việt Nam.
- `shift` là sáng / chiều / không rõ.
- `content` là nguyên văn phần đề, bắt buộc, ít nhất 30 ký tự. Không ghi tên hay thông tin cá nhân.
- Trùng link thì bỏ qua.

Thiện và bot đọc được bảng này, nhân viên không thấy.

### 3. Lắng nghe: `muse_them_lang_nghe`

Mỗi mục: `{ "kind", "label", "level", "posted_at", "group", "author", "quote", "sentiment", "url" }`
- `kind`: `ky_tich`, `doi_thu` hoặc `aptis_one_lab`.
- `label`: tên đối thủ, dùng khi `kind` là `doi_thu`.
- `level`: `cao`, `vua` hoặc `thap` (nhận cả 🔴 🟡 ⚪).
- `author`: tên hiển thị người viết, ẩn danh thì ghi "Ẩn danh".
- `quote`: trích ngắn, dưới 2 câu.
- `sentiment`: khen / chê / hỏi / so sánh.
- Trùng link và trùng trích dẫn thì bỏ qua.

**Chỉ Thiện và bot đọc được bảng này**, vì có tên người viết. Nhân viên không thấy.

## Lệnh bot cho các lịch trên máy đọc 2 bảng mới

- `npm run bot -- review-moi [--hours 48 | --since <ISO>]`: in JSON các review đề Muse đẩy lên sau mốc, mặc định 48 giờ qua.
- `npm run bot -- lang-nghe-moi [--hours 24 | --since <ISO>]`: in JSON các mục lắng nghe Muse đẩy lên sau mốc, mặc định 24 giờ qua.

## Dự phòng nếu Muse bắt buộc dùng MCP

File `supabase/functions/muse-mcp/index.ts` là một MCP server nhỏ, có đúng 3 tool trên. Nó chỉ chuyển lời gọi sang 3 hàm SQL, không giữ khoá bí mật nào. File này **chưa deploy**.

Khi cần thì làm như sau:
1. Vào Supabase → Edge Functions → Deploy new function, đặt tên `muse-mcp`, dán file vào và tắt "Verify JWT".
2. Địa chỉ cho Muse là `https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/muse-mcp`.
3. Muse gửi mã kết nối qua header `Authorization: Bearer <mã>`.

## Đã thử (trên Postgres cục bộ, 13/11)

- Mã: nhân viên bấm tạo mã bị từ chối, chỉ Thiện tạo được. Mã sai bị chặn.
- Bài cần trả lời:
  - 6 bài gửi lên thì ghi 3, bỏ 1 bài trùng, báo lỗi 1 link sai và 1 bài ở group không seeding.
  - 3 bài ghi được chia lần lượt cho An và Châu.
  - Gửi lại bài đã có thì bỏ qua.
- Review đề: link trùng và nội dung quá ngắn bị loại.
- Lắng nghe: `kind` sai bị báo lỗi. Gọi không đăng nhập không đọc được bảng, nhân viên đọc bảng thấy 0 dòng.

## Lưu ý dữ liệu cũ
Trong `seed_targets` đang có 7 bài bị ghi 2 lần với 2 dạng link khác nhau, do bot ghi trước khi sửa. SQL 010 không xoá bài nào. Từ giờ sẽ không bị trùng thêm.

## Hoàn tác

Câu hoàn tác nằm ở cuối file `supabase/010_ket_noi_muse.sql`, đang để ở dạng chú thích. Nó xoá 3 hàm, 4 bảng mới và cột `source`.
