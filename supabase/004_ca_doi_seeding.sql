-- 004: Dashboard bản "Cả đội" (Thiện duyệt mockup v2, 06/11/2026)
-- 1) Mọi thành viên đọc được việc của nhau (chỉ ĐỌC; ghi vẫn chỉ của mình / admin).
-- 2) Ý tưởng đăng bài: thêm "Bỏ qua" (ẩn với cả đội, kho tự hiện câu khác).
-- 3) Bài cần trả lời: lưu câu nhân viên đã comment để bot kiểm tra.
-- 4) Chỉ tiêu: mỗi người 10 bài đăng/ngày; bài trả lời An 5, Châu 10.
-- Không xoá dữ liệu nào. Chạy lại nhiều lần vẫn an toàn.

-- ---------- 1) Cả đội xem được việc của nhau ----------
drop policy if exists routines_read on public.routines;
create policy routines_read on public.routines for select to authenticated using (public.is_member());

drop policy if exists daily_checks_read on public.daily_checks;
create policy daily_checks_read on public.daily_checks for select to authenticated using (public.is_member());

drop policy if exists extra_tasks_read on public.extra_tasks;
create policy extra_tasks_read on public.extra_tasks for select to authenticated using (public.is_member());

drop policy if exists seeding_posts_read on public.seeding_posts;
create policy seeding_posts_read on public.seeding_posts for select to authenticated using (public.is_member());

drop policy if exists day_notes_read on public.day_notes;
create policy day_notes_read on public.day_notes for select to authenticated using (public.is_member());

drop policy if exists seeding_reviews_read on public.seeding_reviews;
create policy seeding_reviews_read on public.seeding_reviews for select to authenticated using (public.is_member());

drop policy if exists member_feedback_read on public.member_feedback;
create policy member_feedback_read on public.member_feedback for select to authenticated using (public.is_member());

-- ---------- 2) Bỏ qua ý tưởng ----------
alter table public.seed_ideas add column if not exists skipped_by uuid references public.members(id) on delete set null;
alter table public.seed_ideas add column if not exists skipped_at timestamptz;
create index if not exists seed_ideas_free_idx on public.seed_ideas (taken_by, skipped_at, created_at);

create or replace function public.skip_idea(p_idea uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); n int;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  update public.seed_ideas set skipped_by = me, skipped_at = now()
   where id = p_idea and taken_by is null and skipped_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.skip_idea(uuid) from public, anon;
grant execute on function public.skip_idea(uuid) to authenticated;

-- ---------- 3) Lưu câu đã comment ----------
alter table public.seed_targets add column if not exists comment_text text;

-- Đã trả lời: ghi câu comment, tạo dòng "bài trả lời" (link = bài gốc) cho người làm
create or replace function public.answer_target(p_target uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_member_id(); t public.seed_targets; pid uuid;
begin
  if me is null then raise exception 'Chưa đăng nhập hoặc tài khoản chưa được cấp'; end if;
  if p_text is null or length(trim(p_text)) < 5 then raise exception 'Dán câu bạn đã comment (ít nhất 5 ký tự)'; end if;
  select * into t from public.seed_targets where id = p_target for update;
  if not found then raise exception 'Không tìm thấy bài này'; end if;
  if t.status = 'commented' then raise exception 'Bài này đã có người trả lời rồi'; end if;
  if t.status = 'skipped' or (t.taken_by is not null and t.taken_by <> me) then
    raise exception 'Bài này đã có người khác nhận';
  end if;
  insert into public.seeding_posts (date, member_id, url, group_id, group_name, kind, question, target_id)
  values (public.vn_today(), me, t.url, t.group_id, t.group_name, 'comment', t.question, t.id)
  returning id into pid;
  update public.seed_targets
     set status = 'commented', taken_by = me, taken_at = coalesce(taken_at, now()), post_id = pid, comment_text = trim(p_text)
   where id = p_target;
  return pid;
end $$;
revoke all on function public.answer_target(uuid, text) from public, anon;
grant execute on function public.answer_target(uuid, text) to authenticated;

-- ---------- 4) Chỉ tiêu ----------
update public.members set seeding_quota = 10 where role = 'staff' and active;
update public.members set comment_quota = 5  where lower(login_email) = 'dag@aptiskytich.vn';
update public.members set comment_quota = 10 where lower(login_email) = 'nnmc@aptiskytich.vn';
