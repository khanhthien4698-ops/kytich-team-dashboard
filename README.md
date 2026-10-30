# Dashboard đội nhóm Kỳ Tích

Bảng việc chung của team: nhân viên tick việc hằng ngày, ghi bài seeding, nhận thẻ gợi ý nội dung; Thiện xem Bảng tổng 7 ngày và cài đặt. Bot 8h sáng ghi báo cáo + thẻ gợi ý.

- Frontend: Vite + React (tĩnh), gọi Supabase bằng anon key.
- DB + đăng nhập: một project Supabase **riêng** (không dính gì tới web học viên aptiskytich.vn).
- Phân quyền bằng RLS trong Postgres (`supabase/001_schema.sql`):
  - `admin` (Thiện): toàn quyền, thấy Bảng tổng + Cài đặt.
  - `staff`: chỉ đọc/ghi dữ liệu của chính mình; đọc chung danh sách group và thẻ gợi ý.
  - `bot`: đọc mọi thứ, chỉ ghi `team_reports` và `seed_ideas`.
- "Mình lấy" chạy qua hàm `take_idea()` trong DB nên 2 người bấm cùng lúc cũng chỉ 1 người lấy được.
- Ngày tính theo giờ Việt Nam.

## Xem thử giao diện (không cần Supabase)

```bash
npm install
npm run demo        # mở http://localhost:5173, đăng nhập: thien / thanhvien1 / ... (mật khẩu gì cũng được)
```

---

## Việc Thiện tự làm (theo thứ tự)

### 1. Tạo project Supabase mới (miễn phí)
1. Vào https://supabase.com/dashboard → **New project**. Tên: `kytich-team`. Region: **Southeast Asia (Singapore)**. Đặt database password (lưu vào trình quản lý mật khẩu, không gửi cho ai).
2. Đợi project tạo xong (~2 phút).

### 2. Dán SQL
1. Trong project mới: **SQL Editor → New query**.
2. Mở file `supabase/001_schema.sql`, copy toàn bộ, dán vào, bấm **Run**. Thấy "Success" là xong.
   (File này tạo bảng, phân quyền, và 5 thành viên mẫu: Thiện, Thành viên 1/2/3, Bot sáng.)

### 3. Tắt tự đăng ký + tạo tài khoản
1. **Authentication → Sign In / Providers → Email**: tắt **Allow new users to sign up** → Save. (Chỉ Thiện cấp tài khoản.)
2. **Authentication → Users → Add user → Create new user**, tạo 5 tài khoản, mỗi lần tick **Auto Confirm User**:

   | Email | Dùng cho | Tên đăng nhập trên web |
   |---|---|---|
   | `thien@aptiskytich.vn` | Thiện (admin) | `thien` |
   | `thanhvien1@aptiskytich.vn` | Bạn thứ 1 | `thanhvien1` |
   | `thanhvien2@aptiskytich.vn` | Bạn thứ 2 | `thanhvien2` |
   | `thanhvien3@aptiskytich.vn` | Bạn thứ 3 | `thanhvien3` |
   | `bot@aptiskytich.vn` | Bot sáng | (không dùng web) |

   Mật khẩu: mỗi người một mật khẩu riêng, ≥ 8 ký tự. Email chỉ là "tên đăng nhập", không cần hộp thư thật (Auto Confirm nên Supabase không gửi mail).
   Gửi mật khẩu cho từng bạn qua kênh riêng; các bạn tự đổi ở nút **Mật khẩu** trên web.
3. Muốn dùng email khác: tạo user với email đó, rồi vào web → **Cài đặt → Thành viên** sửa ô email cho khớp.

### 4. Nối web với Supabase và chạy trên máy
1. **Project Settings → API** (hoặc **API Keys**): copy **Project URL** và **anon / publishable key** (key công khai). **Không** copy `service_role` / secret key.
2. Trong thư mục này: copy `.env.example` thành `.env.local`, điền 2 giá trị vừa copy.
3. Chạy:
   ```bash
   npm install
   npm run dev       # mở http://localhost:5173
   ```
4. Đăng nhập `thien` → **Cài đặt**: sửa tên thật các bạn, việc cố định từng người, thêm danh sách group Facebook.

### 5. Lưu mật khẩu bot vào Keychain (máy Mac chạy lịch tự động)
Chạy lệnh này trong Terminal, nó sẽ **hỏi** mật khẩu (gõ mật khẩu của `bot@aptiskytich.vn`, không hiện ra màn hình, không lưu vào lịch sử lệnh):
```bash
security add-generic-password -U -s kytich-dashboard-bot -a bot@aptiskytich.vn -w
```
Kiểm tra:
```bash
npm run bot -- check
# OK: đăng nhập Bot sáng (bot). Thấy 5 thành viên.
```
Lần đầu macOS có thể hỏi "node muốn dùng keychain" → bấm **Always Allow**.

### 6. Đưa code lên GitHub
Tạo repo mới trên GitHub (tài khoản `khanhthien4698-ops`), tên `kytich-team-dashboard`, chọn **Public**, **không** tick tạo README. (Repo public không chứa mật khẩu nào: `.env.local` không bị đẩy lên.) Rồi:
```bash
git remote add origin https://github.com/khanhthien4698-ops/kytich-team-dashboard.git
git push -u origin main
```

### 7. Bật host (chọn 1)

| | **A. Cloudflare Pages** (khuyên dùng) | **B. GitHub Pages** |
|---|---|---|
| Giá | Miễn phí | Miễn phí |
| Repo | Private được | **Phải public** (gói free) |
| Link | `kytich-team.pages.dev` (gắn tên miền riêng được) | `khanhthien4698-ops.github.io/kytich-team-dashboard` |
| Tự cập nhật khi push | Có | Có (qua GitHub Actions) |

**A. Cloudflare Pages** (hoặc Vercel làm tương tự):
1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → chọn repo `kytich-team-dashboard`.
2. Framework preset: **Vite** (hoặc Build command `npm run build`, Output `dist`).
3. **Environment variables**: thêm `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGIN_DOMAIN` = `aptiskytich.vn`.
4. **Save and Deploy** → được link `https://<tên>.pages.dev`.

**B. GitHub Pages** (Thiện đã chọn cách này, repo public):
1. Workflow đã có sẵn ở `.github/workflows/pages.yml`, push lên là tự build.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Repo → **Settings → Secrets and variables → Actions → tab Variables → New repository variable**: thêm 3 biến `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGIN_DOMAIN` (= `aptiskytich.vn`). anon key là key công khai nên để ở Variables được.
4. Vào tab **Actions** chạy lại workflow → link `https://khanhthien4698-ops.github.io/kytich-team-dashboard/`.

Sau khi có link: Supabase → **Authentication → URL Configuration → Site URL** = link đó (cho chắc, đăng nhập mật khẩu không bắt buộc bước này).

---

## Cách kiểm tra "xong"
1. Mở web trên 2 máy (hoặc 1 máy thường + 1 cửa sổ ẩn danh), đăng nhập `thanhvien1` và `thien`.
2. `thanhvien1` tick việc + ghi 1 bài seeding → máy `thien` mở **Bảng tổng** (tự tải lại mỗi phút, hoặc F5) thấy ô hôm nay đổi số/màu, bấm ô thấy link.
3. Đăng nhập `thanhvien2`: không thấy tab Bảng tổng/Cài đặt, không thấy tick/seeding của `thanhvien1`.
4. Bot ghi thử: `npm run bot -- report --text "Báo cáo thử"` → **Bảng tổng → Báo cáo sáng** hiện dòng đó.
   Thêm thẻ gợi ý thử: `npm run bot -- ideas --file scripts/examples/ideas.example.json` → mục **Gợi ý nội dung hôm nay**.
5. 2 bạn cùng bấm "Mình lấy" 1 thẻ → chỉ 1 người lấy được, người kia báo "vừa có người khác lấy".
6. Điện thoại (390px): không phải kéo ngang trang (riêng Bảng tổng kéo ngang trong khung bảng).

## Script bot (cho lịch tự động)
```bash
npm run bot -- check                                   # thử đăng nhập
npm run bot -- yesterday                               # JSON dữ liệu hôm qua từng người + TB 7 ngày + chủ đề 3 ngày gần
npm run bot -- report --file report.json               # [{ "member": null | "Tên", "text": "..." }]
npm run bot -- report --text "..." --member "Thành viên 2"
npm run bot -- ideas --file ideas.json                 # xem scripts/examples/ideas.example.json
npm run bot -- groups                                  # danh sách group đang dùng
npm run bot -- run-start morning                       # DONE / BUSY / GO (dùng trong lịch tự động)
```
- `member: null` = báo cáo chung (hiện ở Bảng tổng); có tên = nhắc riêng (hiện ở "Hôm nay của tôi" của người đó).
- Chạy lại `report` cùng ngày sẽ ghi đè báo cáo cũ của ngày đó.
- Câu hỏi trong thẻ gợi ý phải **viết lại**, bỏ hết tên/SĐT/thông tin khách.

## Seeding: bài đăng + comment, bot chấm, cơ hội seeding
Cần dán thêm `supabase/002_seeding_review.sql` vào SQL Editor (sau file 001).

Seeding gồm 2 loại, chỉ tiêu riêng cho từng người ở **Cài đặt** (mặc định 2 bài + 5 comment/ngày cho người mới; người đã có giữ chỉ tiêu bài cũ và được 5 comment):
- **Bài đăng**: link bài.
- **Comment vào bài người khác**: link tới comment (bấm vào giờ đăng của comment để lấy link; không lấy được thì dán link bài gốc), kèm ô tuỳ chọn "bài gốc hỏi gì" (1 dòng, tự viết lại, không ghi tên người đăng).

Bảng tổng ghi mỗi ô "Việc x/y · Bài a/b · Cmt c/d", ★ điểm bot chấm TB, ⚠ số bài/comment bị gỡ, bị ẩn hoặc vi phạm.

### Hai lịch tự động (scheduled task của Claude trên máy Thiện)
| Lịch | Chạy | Làm gì |
|---|---|---|
| `kytich-doi-nhom-10h` | mỗi 10 phút, 08:00–16:50 (task id giữ tên cũ) | chấm bài/comment hôm qua, góp ý, báo cáo đội nhóm, 8–12 thẻ gợi ý |
| `kytich-doi-nhom-17h` | mỗi 10 phút, 17:00–23:50 | đọc group (chỉ đọc, đọc chậm): ghi "Cơ hội seeding" (chỉ group Key Aptis miễn phí, group duy nhất team được seeding từ 30/10) + gom review đề thi 48h qua vào `CLAUDE OUTPUTS/<ngày mai>-key/review_raw.txt` (chỉ ghi thêm, đối chiếu trùng, không tự làm key) |
| `kytich-quet-group-3h` (chưa tạo) | mỗi 10 phút, khung 8h/11h/14h/20h | quét group Key Aptis miễn phí, ghi bài mới vào "Cơ hội seeding"; trang Hôm nay hiện thẻ "Có X bài mới cần seeding". `run-start scan` cho mỗi khung chạy 1 lần, các lượt dùng chung khoá Facebook nên không chạy chồng |

Mỗi lần chạy, bot gọi `npm run bot -- run-start morning|evening` trước: `DONE` (hôm nay xong rồi) hoặc `BUSY` (lần trước đang chạy) thì dừng ngay; `GO` thì làm. Xong gọi `run-done`, lỗi gọi `run-fail` để 10 phút sau thử lại. Nhờ vậy máy bật muộn vẫn chạy đúng 1 lần/ngày. Trạng thái lưu ở `~/Library/Application Support/kytich-bot/` (khoá treo quá 60 phút tự bỏ).
Lịch chỉ chạy khi app Claude đang mở và máy bật; Chrome phải đang đăng nhập Facebook.

### Lịch 17h: tìm "Cơ hội seeding"
1. Dùng Claude in Chrome đọc các group trong danh sách, **CHỈ ĐỌC**, tìm bài của người khác trong 24 giờ đáng vào comment: hỏi về Aptis, hỏi chỗ ôn/tài liệu, than khó, hỏi key, hỏi lịch thi… mà Kỳ Tích chưa vào trả lời.
2. Ghi file JSON theo mẫu `scripts/examples/targets.example.json`: `url`, `group` (đúng tên trong Cài đặt), `question` (tóm tắt câu hỏi, **viết lại**, không tên người đăng), `angle` (góc trả lời gợi ý), `assigned_to` (chia đều các bạn).
3. `npm run bot -- targets --file targets.json`. Bài trùng link đã có thì bỏ qua, không đổi trạng thái.

Trên web, mục **Cơ hội seeding** ở "Hôm nay của tôi": "Mình nhận" (không 2 người nhận trùng) → comment trên Facebook → "Đã comment" + dán link comment: tự thành 1 dòng seeding loại Comment nối với cơ hội. Có "Trả lại" / "Bỏ qua". Tab **Hiệu quả** đếm số cơ hội tìm được, đã comment, bỏ qua, bỏ lỡ theo người và theo group.

### Lịch 8h: chấm bài + comment hôm qua
1. `npm run bot -- to-review` → JSON các bài/comment **hôm qua** chưa chấm (`--kind post` hoặc `--kind comment` để lọc).
2. Claude in Chrome mở từng link, **CHỈ ĐỌC**: không like, không comment, không chia sẻ, không đăng gì lên Facebook.
3. Chấm theo tiêu chí dưới, viết file theo mẫu `scripts/examples/reviews.example.json`.
4. `npm run bot -- reviews --file reviews.json` → ghi review + nhận xét tổng từng người. Chạy lại thì ghi đè.

Kết quả hiện ở: "Hôm nay của tôi → Góp ý hôm qua" (mỗi bạn chỉ thấy của mình), ô Bảng tổng, tab **Hiệu quả** (7/30 ngày theo người, theo group, top 5).

**Tiêu chí chấm BÀI ĐĂNG**
| Trường | Cách điền |
|---|---|
| `status` | `live` còn hiện; `removed` bị admin group gỡ / không còn; `pending` đang chờ duyệt; `unreachable` không mở được |
| `reactions`, `comments`, `shares` | Số đếm lúc mở (khoảng 24 giờ sau khi đăng). Không thấy thì `null` |
| `score` 1–5 | 5: trả lời đúng câu hỏi thật, có giá trị rõ, câu mở hút, tương tác tốt. 3: ổn nhưng chung chung / tương tác thấp. 1: bị gỡ hoặc vi phạm |
| `good` / `improve` | Mỗi cái 1 câu: điểm tốt (câu mở, đúng trọng tâm, ví dụ, tài liệu tặng…) và điều cần sửa |
| `suggestion` | 1–2 câu cụ thể: câu mở viết lại, hoặc ý cho bài sau |

**Tiêu chí chấm COMMENT** (vào bài người khác)
| Trường | Cách điền |
|---|---|
| `status` | `live` comment còn; `hidden` bị ẩn (admin/người đăng ẩn, chỉ mình thấy); `removed` bị xoá hoặc bài gốc bị gỡ; `unreachable` không mở được |
| `reactions` | Lượt thích của **chính comment** |
| `comments` | Số trả lời dưới **chính comment** |
| `asker_replied` | `true` nếu người hỏi (chủ bài) phản hồi/thả cảm xúc vào comment, `false` nếu không, `null` nếu không xem được |
| `score` 1–5 | 5: trả lời đúng câu hỏi thật, có ích, tự nhiên, người hỏi phản hồi. 3: đúng nhưng chung chung. 1–2: giống spam (dán link trơ trọi, văn mẫu lặp lại), bị ẩn/xoá, hoặc vi phạm |
| `good` / `improve` / `suggestion` | Như bài đăng; gợi ý nên là câu trả lời viết lại ngắn gọn hơn / tự nhiên hơn |

**`rule_flags`** (dùng cho cả hai; không vi phạm thì `[]`): `dong_vai_hoc_vien` (giả làm học viên), `chep_tin_khach` (chép nguyên tin nhắn khách), `spam_link` (link lộ liễu, dán link trơ trọi), `van_mau` (văn mẫu lặp lại giữa nhiều comment), `sai_group` (không hợp chủ đề group).

Nhận xét tổng (`feedback`): mỗi bạn 2–3 câu: bao nhiêu bài/comment còn sống, điểm TB, cái tốt nhất, 1 việc nên làm khác hôm nay.

**Không** chép tên, ảnh hay thông tin của người khác trong group (người hỏi, người comment) vào review, cơ hội hay nhận xét.

## Để sau
- Danh sách khách (CRM): tab "Khách (sắp có)" đã chừa sẵn, sẽ thêm bảng `customers` ở `supabase/002_*.sql`.
- Kiểm thử RLS cục bộ: `supabase/test_rls.sql`, `supabase/test_rls_002.sql` (chạy trên Postgres local có giả lập `auth.jwt()`, không chạy trên Supabase thật).
