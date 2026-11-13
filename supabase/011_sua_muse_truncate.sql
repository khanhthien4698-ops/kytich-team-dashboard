-- 011: Sửa lỗi hàm muse_them_bai_can_tra_loi trên Supabase ("DELETE requires a WHERE clause") — chỉ thay 1 hàm.
-- Hoàn tác: không cần (chỉ đổi delete thành truncate bảng tạm).

create or replace function public.muse_them_bai_can_tra_loi(items jsonb, p_key text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  it jsonb; i int := 0; u text; gid text; g_id uuid; g_name text; q text; added int := 0; dup int := 0;
  errs jsonb := '[]'::jsonb; who uuid; new_id uuid;
  seed_names text[] := array['Key Aptis miễn phí - update liên tục', 'Hội review đề Aptis có tâm'];
begin
  perform public.muse_kiem_ma(p_key, 'them_bai_can_tra_loi');
  if jsonb_typeof(items) <> 'array' then raise exception 'items phải là mảng'; end if;
  if jsonb_array_length(items) > 50 then raise exception 'Tối đa 50 bài mỗi lần gọi'; end if;

  -- tải hiện tại của từng người (bài mới đang giao + bài đã nhận chưa xong, ở 2 group seeding, từ 05/11)
  create temp table if not exists _muse_load (member_id uuid primary key, quota int, ord int, n int) on commit drop;
  truncate _muse_load;   -- Supabase chặn DELETE không có WHERE
  insert into _muse_load
  select m.id, m.comment_quota, m.sort_order,
    (select count(*) from public.seed_targets t
      where t.group_name = any(seed_names) and t.date >= date '2026-11-05'
        and ((t.status = 'new' and t.assigned_to = m.id) or (t.status = 'taken' and t.taken_by = m.id)))
  from public.members m
  where m.active and m.role = 'staff' and coalesce(m.comment_quota, 0) > 0 and m.name !~ '^Thành viên [0-9]';

  for it in select * from jsonb_array_elements(items) loop
    i := i + 1;
    u := public.muse_chuan_link(it ->> 'url');
    q := btrim(coalesce(it ->> 'question', ''));
    if u is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'Link phải dạng https://www.facebook.com/groups/<mã group>/posts/<mã bài>/'); continue; end if;
    gid := (regexp_match(u, '/groups/([^/]+)/'))[1];
    g_id := null; g_name := null;
    select id, name into g_id, g_name from public.seed_groups where url ~ ('/groups/' || gid || '(/|$)') and name = any(seed_names) limit 1;
    if g_id is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'Chỉ nhận bài ở group "Key Aptis miễn phí - update liên tục" và "Hội review đề Aptis có tâm"'); continue; end if;
    if length(q) < 5 then errs := errs || jsonb_build_object('muc', i, 'loi', 'Thiếu nội dung bài (question)'); continue; end if;
    if length(q) > 5000 then q := left(q, 5000); end if;
    if exists (select 1 from public.seed_targets where public.fb_post_id(url) = public.fb_post_id(u)) then dup := dup + 1; continue; end if;

    new_id := null; who := null;
    select member_id into who from _muse_load order by n::numeric / quota, ord, member_id limit 1;
    insert into public.seed_targets (date, url, group_id, group_name, question, angle, assigned_to, source)
    values (public.vn_today(), u, g_id, g_name, q, nullif(btrim(coalesce(it ->> 'angle', '')), ''), who, 'muse')
    on conflict (url) do nothing returning id into new_id;
    if new_id is null then dup := dup + 1; continue; end if;
    added := added + 1;
    if who is not null then update _muse_load set n = n + 1 where member_id = who; end if;
  end loop;

  insert into public.muse_calls (fn, ok, added, note) values ('them_bai_can_tra_loi', true, added, format('trùng %s, lỗi %s', dup, jsonb_array_length(errs)));
  return jsonb_build_object('da_them', added, 'trung_bo_qua', dup, 'loi', errs);
end $$;

select 'ok' as ket_qua;
