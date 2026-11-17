-- 014: Comment seeding Threads chia cho nhân viên, có ô tích "Đã comment"
-- (Thiện yêu cầu 17/11/2026 ở phiên Threads: chia cho Quyên, Châu, An trong trang Hôm nay, tích đã seeding để bot nhận ra)
-- Danh sách comment và người được giao nằm trong threads_reports.data.seeding (bot ghi, trường "giao").
-- Bảng này chỉ ghi ai đã tích "Đã comment" câu nào, lúc nào. Mỗi câu (ngày + link bài) 1 dòng.
-- Ai đọc: mọi thành viên. Ai tích/bỏ tích: chính người đó (ghi đúng member_id của mình) hoặc admin.
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ.

create table if not exists public.threads_seed_done (
  ngay      date not null,
  link      text not null check (link ~ '^https?://'),
  member_id uuid not null references public.members(id),
  done_at   timestamptz not null default now(),
  primary key (ngay, link)
);

alter table public.threads_seed_done enable row level security;
alter table public.threads_seed_done force row level security;
revoke all on public.threads_seed_done from anon, public;
grant select, insert, delete on public.threads_seed_done to authenticated;

drop policy if exists threads_seed_done_read on public.threads_seed_done;
create policy threads_seed_done_read on public.threads_seed_done for select to authenticated
  using (public.is_member());

drop policy if exists threads_seed_done_ins on public.threads_seed_done;
create policy threads_seed_done_ins on public.threads_seed_done for insert to authenticated
  with check (member_id = public.my_member_id() or public.is_admin());

drop policy if exists threads_seed_done_del on public.threads_seed_done;
create policy threads_seed_done_del on public.threads_seed_done for delete to authenticated
  using (member_id = public.my_member_id() or public.is_admin());
