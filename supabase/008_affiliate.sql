-- 008: Affiliate của nhân viên (Thiện yêu cầu 12/11/2026): đo hoa hồng, cuối tháng Thiện trả tay.
-- Mỗi nhân viên có 1 mã giảm giá trên web Kỳ Tích. Bot sáng đọc (chỉ SELECT) bảng payments bên web Kỳ Tích:
-- đơn đã trả tiền (status='paid') có voucher_code = mã → ghi vào đây. Hoa hồng cố định 10% số tiền thực trả.
-- Không lưu email, tên hay user_id của học viên. Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ.
--
-- Quyền xem: Thiện (admin) thấy cả đội; mỗi nhân viên chỉ thấy mã, đơn và trạng thái trả của chính mình.
-- Quyền ghi: bot + admin ghi mã và đơn; chỉ admin tick "đã trả".

create table if not exists public.affiliate_codes (
  code       text primary key,                      -- mã trên web Kỳ Tích, viết HOA (vd KT-3HQW8)
  member_id  uuid not null references public.members(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_orders (
  payment_id  uuid primary key,                     -- id đơn bên web Kỳ Tích (để chống ghi trùng)
  code        text not null references public.affiliate_codes(code),
  member_id   uuid not null references public.members(id) on delete cascade,
  paid_at     timestamptz not null,
  month       text not null,                        -- 'YYYY-MM' theo giờ Việt Nam, tháng tính hoa hồng
  plan_key    text,                                 -- gói: week / month / quarter / half_year
  amount_vnd  integer not null check (amount_vnd >= 0),      -- số tiền thực trả
  commission_vnd integer not null check (commission_vnd >= 0), -- 10% amount_vnd, làm tròn
  synced_at   timestamptz not null default now()
);
create index if not exists affiliate_orders_month_idx on public.affiliate_orders (month, member_id);

create table if not exists public.affiliate_payouts (
  member_id  uuid not null references public.members(id) on delete cascade,
  month      text not null,                         -- 'YYYY-MM'
  paid       boolean not null default false,
  paid_at    timestamptz,
  note       text,
  primary key (member_id, month)
);

alter table public.affiliate_codes   enable row level security;
alter table public.affiliate_orders  enable row level security;
alter table public.affiliate_payouts enable row level security;
revoke all on public.affiliate_codes, public.affiliate_orders, public.affiliate_payouts from anon;
grant select, insert, update, delete on public.affiliate_codes, public.affiliate_orders, public.affiliate_payouts to authenticated;

drop policy if exists affiliate_codes_read    on public.affiliate_codes;
drop policy if exists affiliate_codes_write   on public.affiliate_codes;
drop policy if exists affiliate_orders_read   on public.affiliate_orders;
drop policy if exists affiliate_orders_write  on public.affiliate_orders;
drop policy if exists affiliate_payouts_read  on public.affiliate_payouts;
drop policy if exists affiliate_payouts_write on public.affiliate_payouts;

create policy affiliate_codes_read on public.affiliate_codes for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy affiliate_codes_write on public.affiliate_codes for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

create policy affiliate_orders_read on public.affiliate_orders for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy affiliate_orders_write on public.affiliate_orders for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

create policy affiliate_payouts_read on public.affiliate_payouts for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy affiliate_payouts_write on public.affiliate_payouts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3 mã con tổng đã tạo trên web Kỳ Tích (12/11/2026), gắn theo email đăng nhập dashboard
insert into public.affiliate_codes (code, member_id)
select v.code, m.id from (values
  ('KT-3HQW8', 'dag@aptiskytich.vn'),       -- Đinh Gia An
  ('KT-9CZT5', 'nnmc@aptiskytich.vn'),      -- Nguyễn Ngọc Minh Châu
  ('KT-7MXR4', 'quyendtk@aptiskytich.vn')   -- Đặng Thị Khánh Quyên
) as v(code, email)
join public.members m on lower(m.login_email) = v.email
on conflict (code) do update set member_id = excluded.member_id, active = true;

select c.code, m.name from public.affiliate_codes c join public.members m on m.id = c.member_id order by c.code;
