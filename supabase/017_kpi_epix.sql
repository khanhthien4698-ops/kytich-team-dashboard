-- 017: KPI EPIX trên trang Cả đội (Thiện chốt 25/11/2026)
-- Mục tiêu đợt 26/11 - 05/12/2026: 20.000 lượt truy cập web, 3.000 user mới, group Zalo 1.000 và group Facebook 1.000 thành viên.
--   epix_kpi_ngay  : số theo ngày của web EPIX. Bot ghi (lịch tự động đọc Lovable analytics + bảng profiles của DB EPIX).
--                    truy_cap = lượt khách (visitors), user_moi = tài khoản tạo trong ngày giờ VN, giống báo cáo cổ đông.
--   epix_group_ngay: số thành viên group Zalo / Facebook, Thiện nhập tay mỗi ngày.
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ, không xoá dữ liệu.

create table if not exists public.epix_kpi_ngay (
  d         date primary key,
  truy_cap  int not null default 0 check (truy_cap >= 0),
  user_moi  int not null default 0 check (user_moi >= 0),
  cap_nhat  timestamptz not null default now()
);

create table if not exists public.epix_group_ngay (
  d         date not null,
  kenh      text not null check (kenh in ('zalo', 'fb')),
  so_tv     int not null check (so_tv between 0 and 10000000),
  member_id uuid references public.members(id),
  luc       timestamptz not null default now(),
  primary key (d, kenh)
);

alter table public.epix_kpi_ngay enable row level security;
alter table public.epix_kpi_ngay force row level security;
alter table public.epix_group_ngay enable row level security;
alter table public.epix_group_ngay force row level security;
revoke all on public.epix_kpi_ngay, public.epix_group_ngay from anon, public;
grant select, insert, update on public.epix_kpi_ngay, public.epix_group_ngay to authenticated;
grant delete on public.epix_group_ngay to authenticated;

drop policy if exists epix_kpi_read on public.epix_kpi_ngay;
create policy epix_kpi_read on public.epix_kpi_ngay for select to authenticated using (public.is_member());
drop policy if exists epix_kpi_ins on public.epix_kpi_ngay;
create policy epix_kpi_ins on public.epix_kpi_ngay for insert to authenticated with check (public.is_bot() or public.is_admin());
drop policy if exists epix_kpi_upd on public.epix_kpi_ngay;
create policy epix_kpi_upd on public.epix_kpi_ngay for update to authenticated
  using (public.is_bot() or public.is_admin()) with check (public.is_bot() or public.is_admin());

drop policy if exists epix_group_read on public.epix_group_ngay;
create policy epix_group_read on public.epix_group_ngay for select to authenticated using (public.is_member());
drop policy if exists epix_group_ins on public.epix_group_ngay;
create policy epix_group_ins on public.epix_group_ngay for insert to authenticated with check (public.is_admin() or public.is_bot());
drop policy if exists epix_group_upd on public.epix_group_ngay;
create policy epix_group_upd on public.epix_group_ngay for update to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());
drop policy if exists epix_group_del on public.epix_group_ngay;
create policy epix_group_del on public.epix_group_ngay for delete to authenticated using (public.is_admin());
