-- 010: Kết nối Muse (trợ lý AI của Meta) → dashboard (Thiện giao 13/11/2026).
-- Muse đọc group Facebook bằng tài khoản Thiện rồi tự đẩy kết quả lên dashboard qua 3 hàm GHI (không đọc, sửa, xoá):
--   muse_them_bai_can_tra_loi(items) → seed_targets (Bài cần trả lời), chia người như lệnh bot `targets`
--   muse_them_review(items)          → bảng mới group_reviews (review đề thi thật)
--   muse_them_lang_nghe(items)       → bảng mới group_listening (lắng nghe; CHỈ Thiện + bot đọc được)
-- Muse gọi qua REST của Supabase: POST https://jnlklvsuaqwizlohiknx.supabase.co/rest/v1/rpc/<tên hàm>
--   header: apikey = anon key công khai của dashboard; x-muse-key = mã kết nối Muse.
-- Mã kết nối: chỉ Thiện tạo/thu hồi ở tab Cài đặt (mục "Kết nối Muse"); DB chỉ lưu mã băm SHA-256,
-- mã thật hiện đúng 1 lần lúc tạo. Không dùng service key. Giới hạn 200 lần gọi/giờ, 50 mục/lần.
-- Chạy lại nhiều lần vẫn an toàn. Câu hoàn tác ở cuối file.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Mã kết nối + nhật ký gọi
-- ---------------------------------------------------------------------
create table if not exists public.muse_keys (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique,             -- sha256 hex của mã, không lưu mã thật
  key_hint     text not null,                    -- 4 ký tự cuối để Thiện nhận ra mã nào
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create table if not exists public.muse_calls (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  fn     text not null,
  ok     boolean not null,
  added  int not null default 0,
  note   text
);
create index if not exists muse_calls_at_idx on public.muse_calls (at);

alter table public.muse_keys  enable row level security;
alter table public.muse_calls enable row level security;
revoke all on public.muse_keys, public.muse_calls from anon, public;
grant select on public.muse_keys, public.muse_calls to authenticated;
drop policy if exists muse_keys_owner  on public.muse_keys;
drop policy if exists muse_calls_owner on public.muse_calls;
create policy muse_keys_owner  on public.muse_keys  for select to authenticated using (public.is_owner());
create policy muse_calls_owner on public.muse_calls for select to authenticated using (public.is_owner() or public.is_bot());

-- ---------------------------------------------------------------------
-- Bảng mới: review đề + lắng nghe. Bài cần trả lời dùng seed_targets có sẵn, thêm cột nguồn.
-- ---------------------------------------------------------------------
alter table public.seed_targets add column if not exists source text not null default 'bot';

create table if not exists public.group_reviews (
  id         uuid primary key default gen_random_uuid(),
  url        text not null unique,               -- permalink bài, chống trùng
  group_name text,
  posted_at  text,                               -- giờ đăng như Muse đọc được (dd/mm HH:MM)
  exam_date  text,                               -- ngày thi
  shift      text,                               -- ca: sáng / chiều / không rõ
  location   text,                               -- địa điểm: HMĐ, BC… / không rõ
  content    text not null,                      -- nguyên văn phần đề (không tên, không thông tin cá nhân)
  source     text not null default 'muse',
  created_at timestamptz not null default now()
);
create index if not exists group_reviews_created_idx on public.group_reviews (created_at);

create table if not exists public.group_listening (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('ky_tich', 'doi_thu', 'aptis_one_lab')),
  label      text,                               -- tên đối thủ (với kind = doi_thu)
  level      text not null check (level in ('cao', 'vua', 'thap')),  -- 🔴 / 🟡 / ⚪
  posted_at  text,
  group_name text,
  author     text,                               -- tên hiển thị người viết, "Ẩn danh" nếu ẩn danh
  quote      text not null,                      -- trích ngắn, dưới 2 câu
  sentiment  text,                               -- khen / chê / hỏi / so sánh
  url        text not null,
  source     text not null default 'muse',
  created_at timestamptz not null default now(),
  unique (url, quote)
);
create index if not exists group_listening_created_idx on public.group_listening (created_at);

alter table public.group_reviews   enable row level security;
alter table public.group_listening enable row level security;
revoke all on public.group_reviews, public.group_listening from anon, public;
grant select, insert, update, delete on public.group_reviews, public.group_listening to authenticated;
drop policy if exists group_reviews_read    on public.group_reviews;
drop policy if exists group_reviews_write   on public.group_reviews;
drop policy if exists group_listening_owner on public.group_listening;
-- Review đề không có thông tin cá nhân: Thiện + bot đọc/ghi
create policy group_reviews_read  on public.group_reviews for select to authenticated using (public.is_admin() or public.is_bot());
create policy group_reviews_write on public.group_reviews for all to authenticated
  using (public.is_admin() or public.is_bot()) with check (public.is_admin() or public.is_bot());
-- Lắng nghe có tên hiển thị người viết: CHỈ chủ (Thiện) + bot, nhân viên không thấy
create policy group_listening_owner on public.group_listening for all to authenticated
  using (public.is_owner() or public.is_bot()) with check (public.is_owner() or public.is_bot());

-- ---------------------------------------------------------------------
-- Tạo / thu hồi mã (chỉ Thiện, gọi từ tab Cài đặt)
-- ---------------------------------------------------------------------
create or replace function public.muse_tao_ma() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare k text;
begin
  if not public.is_owner() then raise exception 'Chỉ Thiện tạo được mã Muse'; end if;
  k := 'muse_' || encode(extensions.gen_random_bytes(24), 'hex');
  update public.muse_keys set revoked_at = now() where revoked_at is null;   -- mỗi lúc chỉ 1 mã dùng được
  insert into public.muse_keys (key_hash, key_hint) values (encode(extensions.digest(k, 'sha256'), 'hex'), right(k, 4));
  return k;   -- trả về đúng 1 lần, DB không lưu mã thật
end $$;

create or replace function public.muse_thu_hoi_ma() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not public.is_owner() then raise exception 'Chỉ Thiện thu hồi được mã Muse'; end if;
  update public.muse_keys set revoked_at = now() where revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Kiểm mã + giới hạn gọi (dùng chung cho 3 hàm ghi)
-- ---------------------------------------------------------------------
create or replace function public.muse_kiem_ma(p_key text, p_fn text) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare k text; h text; kid uuid;
begin
  k := coalesce(nullif(p_key, ''), nullif(current_setting('request.headers', true)::json ->> 'x-muse-key', ''));
  if k is null then raise exception 'Thiếu mã kết nối: gửi header x-muse-key (hoặc trường p_key)'; end if;
  h := encode(extensions.digest(k, 'sha256'), 'hex');
  select id into kid from public.muse_keys where key_hash = h and revoked_at is null;
  if kid is null then
    insert into public.muse_calls (fn, ok, note) values (p_fn, false, 'sai mã');
    raise exception 'Mã kết nối sai hoặc đã bị thu hồi';
  end if;
  if (select count(*) from public.muse_calls where at > now() - interval '1 hour') >= 200 then
    raise exception 'Quá 200 lần gọi trong 1 giờ, thử lại sau';
  end if;
  update public.muse_keys set last_used_at = now() where id = kid;
end $$;

-- Tên rút gọn của group → mã số (cùng 1 group Facebook có 2 dạng link, vd hoireviewdeaptis = 1551779633112657).
-- Bot quét và Muse ghi dạng nào cũng được đổi về dạng số trước khi lưu. Thêm dòng ở đây khi gặp group mới có tên rút gọn.
create table if not exists public.fb_group_alias (
  alias     text primary key,        -- tên rút gọn trong link, viết thường
  group_num text not null            -- mã số group
);
insert into public.fb_group_alias (alias, group_num) values ('hoireviewdeaptis', '1551779633112657')
on conflict (alias) do update set group_num = excluded.group_num;
alter table public.fb_group_alias enable row level security;
revoke all on public.fb_group_alias from anon, public;
grant select on public.fb_group_alias to authenticated;
drop policy if exists fb_group_alias_read on public.fb_group_alias;
create policy fb_group_alias_read on public.fb_group_alias for select to authenticated using (public.is_member());

-- Mã bài (số sau /posts/ hoặc /permalink/): dùng để chống trùng, vì 1 bài có thể có 2 dạng link
create or replace function public.fb_post_id(p_url text) returns text
language sql immutable as $$
  select (regexp_match(coalesce(p_url, ''), '/groups/[^/?#]+/(?:posts|permalink)/([0-9]+)'))[1]
$$;
create index if not exists seed_targets_post_id_idx on public.seed_targets (public.fb_post_id(url));
create index if not exists group_reviews_post_id_idx on public.group_reviews (public.fb_post_id(url));
create index if not exists group_listening_post_id_idx on public.group_listening (public.fb_post_id(url));

-- Link bài chuẩn: https://www.facebook.com/groups/<mã số group nếu biết>/posts/<mã bài>/ ; trả null nếu sai dạng
create or replace function public.muse_chuan_link(p_url text) returns text
language sql stable security definer set search_path = public as $$
  select case when m is null then null
    else 'https://www.facebook.com/groups/'
      || coalesce((select a.group_num from public.fb_group_alias a where a.alias = lower(m[1])), m[1])
      || '/posts/' || m[2] || '/' end
  from (select regexp_match(coalesce(p_url, ''), '^https?://(?:www\.|m\.|web\.)?facebook\.com/groups/([A-Za-z0-9._-]+)/(?:posts|permalink)/([0-9]+)')) x(m)
$$;

-- ---------------------------------------------------------------------
-- 1) Bài cần trả lời → seed_targets
-- items: [{ "url", "question" (nội dung bài nguyên văn, đã che tên/SĐT/email), "angle" (gợi ý trả lời, tuỳ chọn) }]
-- Chỉ nhận bài ở 2 group seeding (nhận ra theo mã group trong link). Trùng link thì bỏ qua.
-- Chia người: ai đang ôm ít bài mở nhất (so theo tỉ lệ ô cmt/ngày ở Cài đặt) được giao trước — như lệnh bot `targets`.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2) Review đề → group_reviews
-- items: [{ "url", "group", "posted_at", "exam_date", "shift", "location", "content" }]
-- ---------------------------------------------------------------------
create or replace function public.muse_them_review(items jsonb, p_key text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare it jsonb; i int := 0; u text; c text; added int := 0; dup int := 0; errs jsonb := '[]'::jsonb; new_id uuid;
begin
  perform public.muse_kiem_ma(p_key, 'them_review');
  if jsonb_typeof(items) <> 'array' then raise exception 'items phải là mảng'; end if;
  if jsonb_array_length(items) > 50 then raise exception 'Tối đa 50 review mỗi lần gọi'; end if;
  for it in select * from jsonb_array_elements(items) loop
    i := i + 1;
    u := public.muse_chuan_link(it ->> 'url');
    c := btrim(coalesce(it ->> 'content', ''));
    if u is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'Link phải dạng https://www.facebook.com/groups/<mã group>/posts/<mã bài>/'); continue; end if;
    if length(c) < 30 then errs := errs || jsonb_build_object('muc', i, 'loi', 'Thiếu nội dung đề (content), cần nguyên văn phần đề'); continue; end if;
    if exists (select 1 from public.group_reviews where public.fb_post_id(url) = public.fb_post_id(u)) then dup := dup + 1; continue; end if;
    new_id := null;
    insert into public.group_reviews (url, group_name, posted_at, exam_date, shift, location, content, source)
    values (u, left(it ->> 'group', 200), left(it ->> 'posted_at', 40), left(it ->> 'exam_date', 40), left(it ->> 'shift', 40),
            left(it ->> 'location', 100), left(c, 20000), 'muse')
    on conflict (url) do nothing returning id into new_id;
    if new_id is null then dup := dup + 1; else added := added + 1; end if;
  end loop;
  insert into public.muse_calls (fn, ok, added, note) values ('them_review', true, added, format('trùng %s, lỗi %s', dup, jsonb_array_length(errs)));
  return jsonb_build_object('da_them', added, 'trung_bo_qua', dup, 'loi', errs);
end $$;

-- ---------------------------------------------------------------------
-- 3) Lắng nghe → group_listening
-- items: [{ "kind": "ky_tich"|"doi_thu"|"aptis_one_lab", "label", "level": "cao"|"vua"|"thap" (hoặc 🔴🟡⚪),
--           "posted_at", "group", "author", "quote", "sentiment", "url" }]
-- ---------------------------------------------------------------------
create or replace function public.muse_them_lang_nghe(items jsonb, p_key text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare it jsonb; i int := 0; u text; k text; lv text; qt text; added int := 0; dup int := 0; errs jsonb := '[]'::jsonb; new_id uuid;
begin
  perform public.muse_kiem_ma(p_key, 'them_lang_nghe');
  if jsonb_typeof(items) <> 'array' then raise exception 'items phải là mảng'; end if;
  if jsonb_array_length(items) > 50 then raise exception 'Tối đa 50 mục mỗi lần gọi'; end if;
  for it in select * from jsonb_array_elements(items) loop
    i := i + 1;
    u := public.muse_chuan_link(it ->> 'url');
    k := lower(btrim(coalesce(it ->> 'kind', '')));
    k := case when k in ('ky_tich', 'kỳ tích', 'ky tich') then 'ky_tich'
              when k in ('doi_thu', 'đối thủ', 'doi thu') then 'doi_thu'
              when k in ('aptis_one_lab', 'aptis one-lab', 'aptis one', 'aptis lab') then 'aptis_one_lab' end;
    lv := btrim(coalesce(it ->> 'level', ''));
    lv := case when lv in ('cao', '🔴') then 'cao' when lv in ('vua', 'vừa', '🟡') then 'vua' when lv in ('thap', 'thấp', '⚪') then 'thap' end;
    qt := btrim(coalesce(it ->> 'quote', ''));
    if u is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'Link phải dạng https://www.facebook.com/groups/<mã group>/posts/<mã bài>/'); continue; end if;
    if k is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'kind phải là ky_tich, doi_thu hoặc aptis_one_lab'); continue; end if;
    if lv is null then errs := errs || jsonb_build_object('muc', i, 'loi', 'level phải là cao, vua hoặc thap'); continue; end if;
    if length(qt) < 3 then errs := errs || jsonb_build_object('muc', i, 'loi', 'Thiếu trích dẫn (quote)'); continue; end if;
    if exists (select 1 from public.group_listening where public.fb_post_id(url) = public.fb_post_id(u) and quote = left(qt, 600)) then dup := dup + 1; continue; end if;
    new_id := null;
    insert into public.group_listening (kind, label, level, posted_at, group_name, author, quote, sentiment, url, source)
    values (k, left(it ->> 'label', 100), lv, left(it ->> 'posted_at', 40), left(it ->> 'group', 200), left(it ->> 'author', 100),
            left(qt, 600), left(it ->> 'sentiment', 40), u, 'muse')
    on conflict (url, quote) do nothing returning id into new_id;
    if new_id is null then dup := dup + 1; else added := added + 1; end if;
  end loop;
  insert into public.muse_calls (fn, ok, added, note) values ('them_lang_nghe', true, added, format('trùng %s, lỗi %s', dup, jsonb_array_length(errs)));
  return jsonb_build_object('da_them', added, 'trung_bo_qua', dup, 'loi', errs);
end $$;

-- Quyền gọi: Muse gọi bằng anon key (kiểm mã bên trong hàm). Hàm tạo/thu hồi mã chỉ người đăng nhập (kiểm chủ bên trong).
revoke all on function public.muse_tao_ma(), public.muse_thu_hoi_ma(), public.muse_kiem_ma(text, text),
  public.muse_them_bai_can_tra_loi(jsonb, text), public.muse_them_review(jsonb, text), public.muse_them_lang_nghe(jsonb, text) from public, anon, authenticated;
grant execute on function public.muse_tao_ma(), public.muse_thu_hoi_ma() to authenticated;
grant execute on function public.muse_them_bai_can_tra_loi(jsonb, text), public.muse_them_review(jsonb, text), public.muse_them_lang_nghe(jsonb, text) to anon, authenticated;

select 'ok' as ket_qua;

-- ===================== HOÀN TÁC (chỉ chạy khi muốn gỡ hết kết nối Muse) =====================
-- drop function if exists public.muse_them_bai_can_tra_loi(jsonb, text), public.muse_them_review(jsonb, text),
--   public.muse_them_lang_nghe(jsonb, text), public.muse_kiem_ma(text, text), public.muse_chuan_link(text),
--   public.muse_tao_ma(), public.muse_thu_hoi_ma();
-- drop index if exists public.seed_targets_post_id_idx;
-- drop table if exists public.group_listening, public.group_reviews, public.muse_calls, public.muse_keys, public.fb_group_alias;
-- drop function if exists public.fb_post_id(text);
-- alter table public.seed_targets drop column if exists source;
