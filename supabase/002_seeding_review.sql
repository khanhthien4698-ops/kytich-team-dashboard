-- =====================================================================
-- 002 — Seeding: comment vào bài người khác, bot chấm bài/comment,
--       góp ý hằng ngày, "Cơ hội seeding" (seed_targets)
-- Chạy SAU 001_schema.sql. Dán toàn bộ vào Supabase > SQL Editor > Run.
-- Chạy lại nhiều lần không sao.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Chỉ tiêu tách riêng: seeding_quota = số BÀI ĐĂNG/ngày, comment_quota = số COMMENT/ngày
-- ---------------------------------------------------------------------
alter table public.members add column if not exists comment_quota int not null default 5 check (comment_quota >= 0);
update public.members set comment_quota = 0 where role <> 'staff' and comment_quota <> 0;
comment on column public.members.seeding_quota is 'Chỉ tiêu bài đăng mỗi ngày';
comment on column public.members.comment_quota is 'Chỉ tiêu comment vào bài người khác mỗi ngày';

-- ---------------------------------------------------------------------
-- Cơ hội seeding: bài của người khác đáng vào comment (bot tìm lúc 17h)
-- ---------------------------------------------------------------------
create table if not exists public.seed_targets (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default public.vn_today(),   -- ngày bot tìm thấy
  url          text not null unique check (url ~* '^https?://'),
  group_id     uuid references public.seed_groups(id) on delete set null,
  group_name   text,
  question     text not null,   -- tóm tắt câu hỏi của bài gốc, ĐÃ VIẾT LẠI, không có tên người đăng
  angle        text,            -- góc trả lời gợi ý
  assigned_to  uuid references public.members(id) on delete set null,
  status       text not null default 'new' check (status in ('new','taken','commented','skipped')),
  taken_by     uuid references public.members(id) on delete set null,
  taken_at     timestamptz,
  post_id      uuid,            -- dòng seeding_posts (loại comment) tạo ra khi bấm "Đã comment"
  created_at   timestamptz not null default now()
);
create index if not exists seed_targets_date_idx on public.seed_targets (date, status);

-- Bài seeding: thêm "bài gốc hỏi gì" (cho comment) và nối với cơ hội
alter table public.seeding_posts add column if not exists question text;
alter table public.seeding_posts add column if not exists target_id uuid references public.seed_targets(id) on delete set null;
do $$ begin
  alter table public.seed_targets add constraint seed_targets_post_fk
    foreign key (post_id) references public.seeding_posts(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Kết quả bot chấm từng bài / comment (mỗi dòng seeding 1 review, chạy lại thì ghi đè)
-- Với comment: reactions = lượt thích comment, comments = số trả lời dưới comment.
-- ---------------------------------------------------------------------
create table if not exists public.seeding_reviews (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null unique references public.seeding_posts(id) on delete cascade,
  checked_at    timestamptz not null default now(),
  status        text not null check (status in ('live','hidden','removed','pending','unreachable')),
  reactions     int check (reactions >= 0),
  comments      int check (comments >= 0),
  shares        int check (shares >= 0),
  asker_replied boolean,        -- chỉ cho comment: người hỏi có phản hồi không
  score         int check (score between 1 and 5),
  good          text,           -- điểm tốt
  improve       text,           -- cần sửa
  suggestion    text,           -- gợi ý viết lại / ý tiếp theo
  rule_flags    text[] not null default '{}'
                check (rule_flags <@ array['dong_vai_hoc_vien','chep_tin_khach','spam_link','sai_group','van_mau']::text[])
);

-- Nhận xét tổng hằng ngày của bot cho từng người (date = ngày của bài được chấm, thường là hôm qua)
create table if not exists public.member_feedback (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  member_id   uuid not null references public.members(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique (date, member_id)
);
create index if not exists member_feedback_member_idx on public.member_feedback (member_id, date);

-- ---------------------------------------------------------------------
-- HÀM
-- ---------------------------------------------------------------------
create or replace function public.owns_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seeding_posts where id = p_post and member_id = public.my_member_id())
$$;

-- "Mình nhận": nhận cơ hội nguyên tử, không cho 2 người nhận trùng
create or replace function public.take_target(p_target uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); n int;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  update public.seed_targets set status = 'taken', taken_by = me, taken_at = now()
   where id = p_target and status = 'new' and taken_by is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Trả lại (về 'new') hoặc bỏ qua ('skipped'): người đã nhận hoặc admin; cơ hội chưa ai nhận thì ai cũng bỏ qua được
create or replace function public.set_target_status(p_target uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); n int;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  if p_status not in ('new','skipped') then raise exception 'Trạng thái không hợp lệ'; end if;
  update public.seed_targets
     set status = p_status,
         taken_by = case when p_status = 'new' then null else coalesce(taken_by, me) end,
         taken_at = case when p_status = 'new' then null else coalesce(taken_at, now()) end
   where id = p_target and status in ('new','taken')
     and (taken_by = me or public.is_admin() or (taken_by is null and p_status = 'skipped'));
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- "Đã comment": tạo dòng seeding loại comment của người đang đăng nhập, nối với cơ hội
create or replace function public.complete_target(p_target uuid, p_url text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); t public.seed_targets; pid uuid;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  if p_url is null or p_url !~* '^https?://' then raise exception 'Link phải bắt đầu bằng http:// hoặc https://'; end if;
  select * into t from public.seed_targets where id = p_target for update;
  if not found then raise exception 'Không tìm thấy cơ hội này'; end if;
  if t.status = 'commented' then raise exception 'Cơ hội này đã có người comment rồi'; end if;
  if t.status = 'skipped' or (t.taken_by is not null and t.taken_by <> me) then
    raise exception 'Cơ hội này đã có người khác nhận';
  end if;
  insert into public.seeding_posts (date, member_id, url, group_id, group_name, kind, question, target_id)
  values (public.vn_today(), me, p_url, t.group_id, t.group_name, 'comment', t.question, t.id)
  returning id into pid;
  update public.seed_targets set status = 'commented', taken_by = me, taken_at = coalesce(taken_at, now()), post_id = pid
   where id = p_target;
  return pid;
end $$;

revoke all on function public.take_target(uuid), public.set_target_status(uuid, text), public.complete_target(uuid, text) from public, anon;
grant execute on function public.take_target(uuid), public.set_target_status(uuid, text), public.complete_target(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- QUYỀN (RLS)
-- ---------------------------------------------------------------------
alter table public.seeding_reviews enable row level security;
alter table public.member_feedback enable row level security;
alter table public.seed_targets    enable row level security;
revoke all on public.seeding_reviews, public.member_feedback, public.seed_targets from anon;
grant select, insert, update, delete on public.seeding_reviews, public.member_feedback, public.seed_targets to authenticated;

drop policy if exists seeding_reviews_read  on public.seeding_reviews;
drop policy if exists seeding_reviews_write on public.seeding_reviews;
drop policy if exists member_feedback_read  on public.member_feedback;
drop policy if exists member_feedback_write on public.member_feedback;
drop policy if exists seed_targets_read     on public.seed_targets;
drop policy if exists seed_targets_write    on public.seed_targets;

-- Review: admin + bot đọc hết; staff chỉ đọc review bài của mình; bot (và admin sửa tay) ghi
create policy seeding_reviews_read on public.seeding_reviews for select to authenticated
  using (public.is_admin() or public.is_bot() or public.owns_post(post_id));
create policy seeding_reviews_write on public.seeding_reviews for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

create policy member_feedback_read on public.member_feedback for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy member_feedback_write on public.member_feedback for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

-- Cơ hội: cả team đọc; bot + admin ghi; staff chỉ nhận/đổi trạng thái qua các hàm ở trên
create policy seed_targets_read on public.seed_targets for select to authenticated using (public.is_member());
create policy seed_targets_write on public.seed_targets for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());
