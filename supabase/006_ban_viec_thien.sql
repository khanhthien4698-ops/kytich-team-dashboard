-- 006: Bàn việc riêng của Thiện trong dashboard (Thiện duyệt 06/11/2026: "làm luôn, giống hệt cái cũ")
-- Dữ liệu có doanh thu, lương, kế hoạch khuyến mãi: CHỈ đúng tài khoản Thiện (thienbk@aptiskytich.vn)
-- đọc và ghi được, cộng tài khoản bot (cho lịch 10h, xem cuối file). Không dùng is_member(), is_admin().
-- Nhân viên gọi API thẳng sẽ ra 0 dòng.
--
-- Một bảng, giữ nguyên cấu trúc của trang Bàn việc cũ (tasks, ideas, focus, reports, days, meta),
-- mỗi dòng là một bản ghi, nội dung để nguyên trong cột data (jsonb), không mất trường nào khi chuyển.
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ.

create table if not exists public.owner_docs (
  col        text not null check (col in ('tasks','ideas','focus','reports','days','meta')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- Ghim đúng user id của Thiện vào hàm (tra 1 lần lúc chạy file này).
-- Đổi email đăng nhập sau này cũng không làm người khác thành chủ.
do $$
declare v uuid;
begin
  select id into v from auth.users where lower(email) = 'thienbk@aptiskytich.vn';
  if v is null then raise exception 'Không tìm thấy tài khoản Thiện trong auth.users'; end if;
  execute format($f$
    create or replace function public.is_owner() returns boolean
    language sql stable as $b$ select coalesce(auth.uid() = %L::uuid, false) $b$
  $f$, v);
end $$;

alter table public.owner_docs enable row level security;
alter table public.owner_docs force row level security;
revoke all on public.owner_docs from anon, public;
grant select, insert, update, delete on public.owner_docs to authenticated;

drop policy if exists owner_docs_owner on public.owner_docs;
create policy owner_docs_owner on public.owner_docs for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Cho trang nhận thay đổi ngay (như trang cũ): bật realtime cho bảng này.
-- Realtime vẫn đi qua RLS nên nhân viên không nhận được gì.
do $$ begin
  alter publication supabase_realtime add table public.owner_docs;
exception when duplicate_object then null; end $$;

-- Tài khoản bot (chạy trên máy Thiện, mật khẩu trong Keychain) đọc/ghi được bảng này để lịch 10h
-- đồng bộ wiki và bot báo cáo sáng vẫn ghi như trang cũ. Không dùng service key (bỏ qua MỌI RLS).
drop policy if exists owner_docs_bot on public.owner_docs;
create policy owner_docs_bot on public.owner_docs for all to authenticated
  using (public.is_bot()) with check (public.is_bot());
