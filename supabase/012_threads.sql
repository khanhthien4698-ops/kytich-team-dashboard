-- 012: Báo cáo đăng bài Threads trên dashboard (mục "Threads", chỉ admin xem)
-- Nguồn: tool đăng bài Threads trên máy Thiện ghi file _dang-bai/bao-cao/<ngày>.json sau mỗi lượt 15 phút.
-- Lệnh `node scripts/bot.mjs threads-day` (tài khoản bot) đọc file đó và ghi vào bảng này, mỗi ngày 1 dòng.
-- Ai đọc: admin và bot. Nhân viên gọi API thẳng ra 0 dòng. Ai ghi: chỉ bot. Không ai xoá qua API.
-- Muốn mở cho cả team xem sau này: đổi policy threads_reports_read sang public.is_member().
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ.

create table if not exists public.threads_reports (
  ngay       date primary key,
  cap_nhat   timestamptz,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.threads_reports enable row level security;
alter table public.threads_reports force row level security;
revoke all on public.threads_reports from anon, public;
grant select, insert, update on public.threads_reports to authenticated;

drop policy if exists threads_reports_read on public.threads_reports;
create policy threads_reports_read on public.threads_reports for select to authenticated
  using (public.is_admin() or public.is_bot());

drop policy if exists threads_reports_bot_ins on public.threads_reports;
create policy threads_reports_bot_ins on public.threads_reports for insert to authenticated
  with check (public.is_bot());

drop policy if exists threads_reports_bot_upd on public.threads_reports;
create policy threads_reports_bot_upd on public.threads_reports for update to authenticated
  using (public.is_bot()) with check (public.is_bot());
