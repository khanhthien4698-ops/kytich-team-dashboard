-- 005: Báo cáo đối thủ / thị trường cho cả team (Thiện yêu cầu 06/11/2026)
-- Bot sáng vào page của các đối thủ (chỉ đọc), tóm tắt event, nội dung mới, tần suất đăng, tương tác.
-- Cả team đọc được; chỉ bot và admin ghi. Không đụng bảng cũ. Chạy lại nhiều lần vẫn an toàn.

create table if not exists public.market_reports (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique default public.vn_today(),
  summary     text not null,            -- 3–5 dòng tóm tắt cho cả team
  competitors jsonb not null default '[]'::jsonb, -- [{ name, url, posts, highlights[], events[], engagement }]
  suggestions jsonb not null default '[]'::jsonb, -- ["việc team nên làm", ...]
  created_at  timestamptz not null default now()
);

alter table public.market_reports enable row level security;
revoke all on public.market_reports from anon;
grant select, insert, update, delete on public.market_reports to authenticated;

drop policy if exists market_reports_read  on public.market_reports;
drop policy if exists market_reports_write on public.market_reports;
create policy market_reports_read on public.market_reports for select to authenticated using (public.is_member());
create policy market_reports_write on public.market_reports for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());
