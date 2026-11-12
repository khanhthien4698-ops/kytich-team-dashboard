-- 009: Lịch đi làm theo tuần (Thiện yêu cầu 12/11/2026).
-- Quyên và Châu điền lịch cho TUẦN SAU (thứ 2 → Chủ nhật), mỗi ngày chọn ca sáng / chiều (không chọn = nghỉ).
-- Chỉ điền được vào thứ 7 và Chủ nhật (giờ Việt Nam). Nộp rồi KHÔNG sửa được; muốn đổi thì nhắn Thiện,
-- Thiện (admin) sửa trên dashboard. Chạy lại nhiều lần vẫn an toàn. Không đụng dữ liệu cũ.

-- Ai phải điền lịch: bật ở tab Cài đặt (ô "Điền lịch tuần")
alter table public.members add column if not exists fills_schedule boolean not null default false;
update public.members set fills_schedule = true
where lower(login_email) in ('quyendtk@aptiskytich.vn', 'nnmc@aptiskytich.vn');

create table if not exists public.work_schedules (
  member_id    uuid not null references public.members(id) on delete cascade,
  week_start   date not null check (extract(isodow from week_start) = 1),   -- thứ 2 của tuần được điền
  days         jsonb not null default '{}'::jsonb,  -- { "2026-11-16": ["sang","chieu"], "2026-11-17": [], ... }
  submitted_at timestamptz not null default now(),
  edited_by_admin_at timestamptz,                    -- Thiện sửa sau khi nhân viên xin đổi
  primary key (member_id, week_start)
);

-- Đang trong giờ điền lịch không: hôm nay (giờ VN) là thứ 7 hoặc CN, và tuần điền là tuần ngay sau
create or replace function public.schedule_window_open(p_week date) returns boolean
language sql stable as $$
  select extract(isodow from public.vn_today()) in (6, 7)
     and p_week = public.vn_today() + (8 - extract(isodow from public.vn_today())::int)
$$;

alter table public.work_schedules enable row level security;
revoke all on public.work_schedules from anon;
grant select, insert, update, delete on public.work_schedules to authenticated;

drop policy if exists work_schedules_read       on public.work_schedules;
drop policy if exists work_schedules_staff_add  on public.work_schedules;
drop policy if exists work_schedules_admin      on public.work_schedules;

-- Xem: Thiện + bot thấy cả đội; nhân viên chỉ thấy lịch của mình
create policy work_schedules_read on public.work_schedules for select to authenticated
  using (public.is_admin() or public.is_bot() or member_id = public.my_member_id());
-- Nhân viên: chỉ THÊM lịch của chính mình, đúng thứ 7 / CN, cho tuần sau. Không có quyền sửa/xoá → nộp rồi là khoá.
create policy work_schedules_staff_add on public.work_schedules for insert to authenticated
  with check (member_id = public.my_member_id() and public.schedule_window_open(week_start));
-- Thiện: sửa / xoá được mọi lịch (khi nhân viên nhắn xin đổi)
create policy work_schedules_admin on public.work_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

select name, fills_schedule from public.members where role = 'staff' order by sort_order;
