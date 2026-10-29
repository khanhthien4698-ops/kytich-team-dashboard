-- =====================================================================
-- Dashboard đội nhóm Kỳ Tích — schema + phân quyền (RLS)
-- Dán TOÀN BỘ file này vào Supabase > SQL Editor > New query > Run.
-- Chạy trên project Supabase MỚI của dashboard, KHÔNG chạy trên DB web học viên.
-- Chạy lại nhiều lần không sao (idempotent).
-- =====================================================================

-- Ngày theo giờ Việt Nam
create or replace function public.vn_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- ---------------------------------------------------------------------
-- BẢNG
-- ---------------------------------------------------------------------

-- Thành viên. Mỗi người gắn với 1 tài khoản đăng nhập qua login_email.
-- role: admin (Thiện) | staff (nhân viên) | bot (lịch tự động)
create table if not exists public.members (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  login_email   text unique,
  role          text not null default 'staff' check (role in ('admin','staff','bot')),
  seeding_quota int  not null default 5 check (seeding_quota >= 0),
  active        boolean not null default true,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- Việc cố định hằng ngày của từng người
create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  title       text not null,
  note        text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Tick việc cố định theo ngày
create table if not exists public.daily_checks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default public.vn_today(),
  member_id   uuid not null references public.members(id) on delete cascade,
  routine_id  uuid not null references public.routines(id) on delete cascade,
  done        boolean not null default false,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (date, member_id, routine_id)
);

-- Việc phát sinh
create table if not exists public.extra_tasks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default public.vn_today(),
  member_id   uuid not null references public.members(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Danh sách group Facebook
create table if not exists public.seed_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  url         text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Thẻ gợi ý seeding (bot đổ vào mỗi sáng)
create table if not exists public.seed_ideas (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default public.vn_today(),
  topic        text not null,
  question     text,          -- câu hỏi người học hay hỏi, ĐÃ VIẾT LẠI, không có thông tin khách
  angle        text,          -- góc viết
  gift_doc     text,          -- tài liệu nên tặng
  assigned_to  uuid references public.members(id) on delete set null,
  taken_by     uuid references public.members(id) on delete set null,
  taken_at     timestamptz,
  created_at   timestamptz not null default now()
);

-- Bài seeding đã đăng
create table if not exists public.seeding_posts (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default public.vn_today(),
  member_id   uuid not null references public.members(id) on delete cascade,
  url         text not null check (url ~* '^https?://'),
  group_id    uuid references public.seed_groups(id) on delete set null,
  group_name  text,
  kind        text not null default 'post' check (kind in ('post','comment')),
  idea_id     uuid references public.seed_ideas(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Ghi chú cuối ngày ("Xong ngày")
create table if not exists public.day_notes (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default public.vn_today(),
  member_id   uuid not null references public.members(id) on delete cascade,
  note        text not null,
  updated_at  timestamptz not null default now(),
  unique (date, member_id)
);

-- Báo cáo sáng của bot. member_id = null là báo cáo chung cả team.
create table if not exists public.team_reports (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default public.vn_today(),
  member_id   uuid references public.members(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique nulls not distinct (date, member_id)
);

-- (Để sau) Danh sách khách / CRM: sẽ thêm bảng public.customers ở migration 002.

create index if not exists daily_checks_date_idx  on public.daily_checks (date);
create index if not exists extra_tasks_date_idx   on public.extra_tasks (date, member_id);
create index if not exists seeding_posts_date_idx on public.seeding_posts (date, member_id);
create index if not exists seed_ideas_date_idx    on public.seed_ideas (date);
create index if not exists day_notes_date_idx     on public.day_notes (date);

-- ---------------------------------------------------------------------
-- HÀM XÁC ĐỊNH NGƯỜI ĐANG ĐĂNG NHẬP (dựa trên email trong JWT)
-- ---------------------------------------------------------------------
create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members
  where active and lower(login_email) = lower(auth.jwt() ->> 'email')
  limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members
  where active and lower(login_email) = lower(auth.jwt() ->> 'email')
  limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.is_bot() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'bot', false) $$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select public.my_role() is not null $$;

-- "Mình lấy": lấy thẻ gợi ý một cách nguyên tử, không cho 2 người lấy trùng.
create or replace function public.take_idea(p_idea uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); n int;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  update public.seed_ideas set taken_by = me, taken_at = now()
   where id = p_idea and taken_by is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Trả thẻ (chỉ người đã lấy hoặc admin)
create or replace function public.release_idea(p_idea uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); n int;
begin
  update public.seed_ideas set taken_by = null, taken_at = null
   where id = p_idea and (taken_by = me or public.is_admin());
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.take_idea(uuid), public.release_idea(uuid) from public, anon;
grant execute on function public.take_idea(uuid), public.release_idea(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- QUYỀN (RLS)
--   admin: toàn quyền
--   bot:   đọc mọi thứ; ghi team_reports, seed_ideas
--   staff: chỉ đọc/ghi dữ liệu của chính mình; đọc chung members (tên), seed_groups, seed_ideas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['members','routines','daily_checks','extra_tasks','seed_groups',
                           'seed_ideas','seeding_posts','day_notes','team_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Xoá policy cũ (để chạy lại file không lỗi)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('members','routines','daily_checks','extra_tasks','seed_groups',
                      'seed_ideas','seeding_posts','day_notes','team_reports')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- members: cả team đọc được danh sách (cần tên để hiện); chỉ admin sửa
create policy members_read  on public.members for select to authenticated using (public.is_member());
create policy members_admin on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- routines: người đó đọc việc của mình; admin/bot đọc hết; chỉ admin sửa
create policy routines_read  on public.routines for select to authenticated
  using (member_id = public.my_member_id() or public.is_admin() or public.is_bot());
create policy routines_admin on public.routines for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Dữ liệu cá nhân theo ngày: chủ sở hữu đọc/ghi của mình; admin toàn quyền; bot chỉ đọc
create policy daily_checks_read  on public.daily_checks for select to authenticated
  using (member_id = public.my_member_id() or public.is_admin() or public.is_bot());
create policy daily_checks_write on public.daily_checks for all to authenticated
  using (member_id = public.my_member_id() or public.is_admin())
  with check (member_id = public.my_member_id() or public.is_admin());

create policy extra_tasks_read  on public.extra_tasks for select to authenticated
  using (member_id = public.my_member_id() or public.is_admin() or public.is_bot());
create policy extra_tasks_write on public.extra_tasks for all to authenticated
  using (member_id = public.my_member_id() or public.is_admin())
  with check (member_id = public.my_member_id() or public.is_admin());

create policy seeding_posts_read  on public.seeding_posts for select to authenticated
  using (member_id = public.my_member_id() or public.is_admin() or public.is_bot());
create policy seeding_posts_write on public.seeding_posts for all to authenticated
  using (member_id = public.my_member_id() or public.is_admin())
  with check (member_id = public.my_member_id() or public.is_admin());

create policy day_notes_read  on public.day_notes for select to authenticated
  using (member_id = public.my_member_id() or public.is_admin() or public.is_bot());
create policy day_notes_write on public.day_notes for all to authenticated
  using (member_id = public.my_member_id() or public.is_admin())
  with check (member_id = public.my_member_id() or public.is_admin());

-- seed_groups: cả team đọc; admin sửa
create policy seed_groups_read  on public.seed_groups for select to authenticated using (public.is_member());
create policy seed_groups_admin on public.seed_groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- seed_ideas: cả team đọc; admin + bot ghi. Staff lấy thẻ qua hàm take_idea().
create policy seed_ideas_read  on public.seed_ideas for select to authenticated using (public.is_member());
create policy seed_ideas_write on public.seed_ideas for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

-- team_reports: admin + bot đọc/ghi; staff đọc báo cáo riêng của mình
create policy team_reports_read  on public.team_reports for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy team_reports_write on public.team_reports for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

-- ---------------------------------------------------------------------
-- DỮ LIỆU BAN ĐẦU (chỉ thêm nếu chưa có)
-- Email đăng nhập phải TRÙNG với tài khoản tạo ở Authentication > Users.
-- ---------------------------------------------------------------------
insert into public.members (name, login_email, role, seeding_quota, sort_order) values
  ('Thiện',        'thien@aptiskytich.vn',      'admin', 0, 0),
  ('Thành viên 1', 'thanhvien1@aptiskytich.vn', 'staff', 5, 1),
  ('Thành viên 2', 'thanhvien2@aptiskytich.vn', 'staff', 5, 2),
  ('Thành viên 3', 'thanhvien3@aptiskytich.vn', 'staff', 5, 3),
  ('Bot sáng',     'bot@aptiskytich.vn',        'bot',   0, 99)
on conflict (login_email) do nothing;

insert into public.routines (member_id, title, sort_order)
select m.id, r.title, r.ord
from public.members m
cross join (values ('Xem gợi ý nội dung hôm nay, nhận thẻ', 1),
                   ('Trả lời tin nhắn / comment trên page', 2),
                   ('Ghi lại câu hỏi hay của học viên', 3)) as r(title, ord)
where m.role = 'staff'
  and not exists (select 1 from public.routines x where x.member_id = m.id);
