-- 015: Kho bài Threads EPIX cho Châu đăng tay (Thiện yêu cầu 25/11/2026 qua phiên 21 Threads)
-- KPI 15 bài/ngày. Bot nạp bài + ảnh (node scripts/bot.mjs threads-kho), người đăng bấm "Đã đăng".
--   threads_kho_bai  : nội dung bài, bot/admin ghi, upsert theo ma. Không có cột trạng thái nên nạp lại không mất "đã đăng".
--   threads_kho_dang : ai đã đăng bài nào, lúc nào, link bài (không bắt buộc). Mỗi bài 1 dòng.
--   Storage bucket threads-kho (riêng tư): ảnh bài, tên file <ma>.png. Thành viên xem/tải qua link ký tạm.
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ. Không có quyền xoá bài trong kho.

create table if not exists public.threads_kho_bai (
  ma            text primary key check (ma ~ '^[A-Za-z0-9_-]{3,60}$'),
  ngay_goi_y    date,
  stt           int,
  loai          text,
  chu           text not null check (length(chu) between 1 and 5000),
  binh_luan_dau text check (binh_luan_dau is null or length(binh_luan_dau) <= 5000),
  anh           text check (anh is null or anh ~ '^[A-Za-z0-9_-]{3,60}\.(png|jpg|jpeg|webp)$'),
  tao_luc       timestamptz not null default now(),
  cap_nhat      timestamptz not null default now()
);

create table if not exists public.threads_kho_dang (
  ma        text primary key references public.threads_kho_bai(ma),
  member_id uuid not null references public.members(id),
  luc       timestamptz not null default now(),
  link      text check (link is null or link ~ '^https?://')
);

alter table public.threads_kho_bai enable row level security;
alter table public.threads_kho_bai force row level security;
alter table public.threads_kho_dang enable row level security;
alter table public.threads_kho_dang force row level security;
revoke all on public.threads_kho_bai, public.threads_kho_dang from anon, public;
grant select, insert, update on public.threads_kho_bai to authenticated;
grant select, insert, update, delete on public.threads_kho_dang to authenticated;

drop policy if exists threads_kho_bai_read on public.threads_kho_bai;
create policy threads_kho_bai_read on public.threads_kho_bai for select to authenticated
  using (public.is_member());
drop policy if exists threads_kho_bai_ins on public.threads_kho_bai;
create policy threads_kho_bai_ins on public.threads_kho_bai for insert to authenticated
  with check (public.is_bot() or public.is_admin());
drop policy if exists threads_kho_bai_upd on public.threads_kho_bai;
create policy threads_kho_bai_upd on public.threads_kho_bai for update to authenticated
  using (public.is_bot() or public.is_admin()) with check (public.is_bot() or public.is_admin());

drop policy if exists threads_kho_dang_read on public.threads_kho_dang;
create policy threads_kho_dang_read on public.threads_kho_dang for select to authenticated
  using (public.is_member());
drop policy if exists threads_kho_dang_ins on public.threads_kho_dang;
create policy threads_kho_dang_ins on public.threads_kho_dang for insert to authenticated
  with check (member_id = public.my_member_id() or public.is_admin());
drop policy if exists threads_kho_dang_upd on public.threads_kho_dang;
create policy threads_kho_dang_upd on public.threads_kho_dang for update to authenticated
  using (member_id = public.my_member_id() or public.is_admin())
  with check (member_id = public.my_member_id() or public.is_admin());
drop policy if exists threads_kho_dang_del on public.threads_kho_dang;
create policy threads_kho_dang_del on public.threads_kho_dang for delete to authenticated
  using (member_id = public.my_member_id() or public.is_admin());

-- Ảnh: bucket riêng tư, tối đa 10MB/ảnh, chỉ ảnh
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('threads-kho', 'threads-kho', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists threads_kho_anh_read on storage.objects;
create policy threads_kho_anh_read on storage.objects for select to authenticated
  using (bucket_id = 'threads-kho' and public.is_member());
drop policy if exists threads_kho_anh_ins on storage.objects;
create policy threads_kho_anh_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'threads-kho' and (public.is_bot() or public.is_admin()));
drop policy if exists threads_kho_anh_upd on storage.objects;
create policy threads_kho_anh_upd on storage.objects for update to authenticated
  using (bucket_id = 'threads-kho' and (public.is_bot() or public.is_admin()))
  with check (bucket_id = 'threads-kho' and (public.is_bot() or public.is_admin()));
