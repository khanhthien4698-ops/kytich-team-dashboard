-- 013: Mở mục Threads cho cả team xem (Thiện chốt 17/11/2026: "Mở cho team")
-- Mọi thành viên đang hoạt động (staff, admin, bot) đọc được threads_reports. Ghi vẫn chỉ bot.
drop policy if exists threads_reports_read on public.threads_reports;
create policy threads_reports_read on public.threads_reports for select to authenticated
  using (public.is_member());
