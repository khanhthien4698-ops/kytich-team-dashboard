-- =====================================================================
-- 002 — Bot chấm bài seeding + góp ý hằng ngày
-- Chạy SAU 001_schema.sql. Dán toàn bộ vào Supabase > SQL Editor > Run.
-- Chạy lại nhiều lần không sao.
-- =====================================================================

-- Kết quả chấm từng bài seeding (mỗi bài 1 dòng, bot chạy lại thì ghi đè)
create table if not exists public.seeding_reviews (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null unique references public.seeding_posts(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  status      text not null check (status in ('live','removed','pending','unreachable')),
  reactions   int check (reactions >= 0),
  comments    int check (comments >= 0),
  shares      int check (shares >= 0),
  score       int check (score between 1 and 5),
  good        text,          -- điểm tốt
  improve     text,          -- cần sửa
  suggestion  text,          -- gợi ý viết lại / ý tiếp theo
  rule_flags  text[] not null default '{}'
              check (rule_flags <@ array['dong_vai_hoc_vien','chep_tin_khach','spam_link','sai_group']::text[])
);

-- Nhận xét tổng hằng ngày của bot cho từng người
-- date = ngày của các bài được chấm (thường là hôm qua)
create table if not exists public.member_feedback (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  member_id   uuid not null references public.members(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique (date, member_id)
);

create index if not exists member_feedback_member_idx on public.member_feedback (member_id, date);

-- Bài này có phải của người đang đăng nhập không
create or replace function public.owns_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seeding_posts where id = p_post and member_id = public.my_member_id())
$$;

alter table public.seeding_reviews enable row level security;
alter table public.member_feedback enable row level security;
revoke all on public.seeding_reviews, public.member_feedback from anon;
grant select, insert, update, delete on public.seeding_reviews, public.member_feedback to authenticated;

drop policy if exists seeding_reviews_read  on public.seeding_reviews;
drop policy if exists seeding_reviews_write on public.seeding_reviews;
drop policy if exists member_feedback_read  on public.member_feedback;
drop policy if exists member_feedback_write on public.member_feedback;

-- Admin + bot đọc hết; staff chỉ đọc review bài của mình
create policy seeding_reviews_read on public.seeding_reviews for select to authenticated
  using (public.is_admin() or public.is_bot() or public.owns_post(post_id));
-- Bot (và admin để sửa tay) ghi
create policy seeding_reviews_write on public.seeding_reviews for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());

create policy member_feedback_read on public.member_feedback for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
create policy member_feedback_write on public.member_feedback for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());
