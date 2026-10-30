-- 003: cho phép "Đưa lại vào danh sách" bài đã bỏ qua trong Cơ hội seeding.
-- Chỉ thay hàm set_target_status (không đổi bảng, không đổi dữ liệu). Chạy lại nhiều lần vẫn an toàn.
-- Thêm đúng 1 trường hợp: bài đang 'skipped' → 'new' (bất kỳ thành viên nào), nhả người nhận.
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
   where id = p_target
     and (
       (status in ('new','taken')
         and (taken_by = me or public.is_admin() or (taken_by is null and p_status = 'skipped')))
       or (status = 'skipped' and p_status = 'new')
     );
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.set_target_status(uuid, text) from public, anon;
grant execute on function public.set_target_status(uuid, text) to authenticated;
