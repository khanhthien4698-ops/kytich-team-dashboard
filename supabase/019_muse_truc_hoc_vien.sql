-- 019: Muse trực trả lời học viên (Thiện duyệt 27/11/2026). Chạy trên DB dashboard.
-- Thêm 27/11: tom_tat_web (số đếm lỗi web, trực web thay lịch kytich-truc-web-2h), lay_bai_can_cham + ghi_cham (chấm seeding thay bước 1 lịch kytich-doi-nhom-10h).
-- Muse gọi 1 cổng duy nhất: edge function muse-cong (supabase/functions/muse-cong), header x-muse-key = mã Muse ở tab Cài đặt.
--   bao_loi : ghi 1 báo lỗi web vào hàng chờ muse_bao_loi. Lịch trên máy đọc bằng `node scripts/bot.mjs muse-loi`.
--   bao_zalo: edge function gửi tin cho Thiện qua bot Zalo; mã bot nằm trong secret, Muse không cầm.
--             Giới hạn 5 tin/giờ, 20 tin/ngày (bot Zalo có 3.000 tin/tháng dùng chung).
--   tra_tai_khoan, tra_cau_de: edge function kiểm mã ở đây rồi mới hỏi DB web Kỳ Tích.
-- Chạy lại nhiều lần vẫn an toàn. Không đụng bảng cũ. Hoàn tác ở cuối file.

create table if not exists public.muse_bao_loi (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  mo_ta      text not null check (length(mo_ta) between 5 and 2000),
  de         text,            -- tên đề nếu có
  ky_nang    text,
  part       text,
  cau        int,
  nguon      text,            -- chỗ thấy lỗi: tin học viên (đã che tên/SĐT), link trang...
  trang_thai text not null default 'moi' check (trang_thai in ('moi', 'da_giao', 'xong', 'bo')),
  ghi_chu    text,
  xu_ly_luc  timestamptz
);
create index if not exists muse_bao_loi_moi_idx on public.muse_bao_loi (at) where trang_thai = 'moi';
alter table public.muse_bao_loi enable row level security;
alter table public.muse_bao_loi force row level security;
revoke all on public.muse_bao_loi from anon, public;
grant select, update on public.muse_bao_loi to authenticated;
drop policy if exists muse_bao_loi_read on public.muse_bao_loi;
drop policy if exists muse_bao_loi_upd  on public.muse_bao_loi;
create policy muse_bao_loi_read on public.muse_bao_loi for select to authenticated using (public.is_owner() or public.is_bot());
create policy muse_bao_loi_upd  on public.muse_bao_loi for update to authenticated
  using (public.is_owner() or public.is_bot()) with check (public.is_owner() or public.is_bot());

-- Cổng: kiểm mã Muse + ghi nhật ký + giới hạn riêng cho Zalo. Edge function gọi trước mỗi việc tra / gửi Zalo.
create or replace function public.muse_cong_kiem(p_fn text, p_key text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_fn not in ('tra_tai_khoan', 'tra_cau_de', 'bao_zalo', 'tom_tat_web', 'lay_bai_can_cham', 'ghi_cham') then raise exception 'Việc không hợp lệ: %', p_fn; end if;
  perform public.muse_kiem_ma(p_key, p_fn);
  if p_fn = 'bao_zalo' then
    if (select count(*) from public.muse_calls where fn = 'bao_zalo' and ok and at > now() - interval '1 hour') >= 5 then
      raise exception 'Đã gửi 5 tin Zalo trong 1 giờ, gom việc lại rồi gửi sau';
    end if;
    if (select count(*) from public.muse_calls where fn = 'bao_zalo' and ok and at > now() - interval '24 hours') >= 20 then
      raise exception 'Đã gửi 20 tin Zalo trong 24 giờ, dừng gửi tới mai';
    end if;
  end if;
  insert into public.muse_calls (fn, ok) values (p_fn, true);
  return jsonb_build_object('ok', true);
end $$;

-- Báo lỗi web → hàng chờ. Tối đa 30 báo lỗi/ngày.
-- p: { "mo_ta" (bắt buộc), "de", "ky_nang", "part", "cau", "nguon" }
create or replace function public.muse_bao_loi(p jsonb, p_key text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare m text; c int; new_id bigint;
begin
  perform public.muse_kiem_ma(p_key, 'bao_loi');
  m := btrim(coalesce(p ->> 'mo_ta', ''));
  if length(m) < 5 then raise exception 'Thiếu mô tả lỗi (mo_ta)'; end if;
  if (select count(*) from public.muse_bao_loi where at > now() - interval '24 hours') >= 30 then
    raise exception 'Đã có 30 báo lỗi trong 24 giờ, gom lại vào 1 báo lỗi';
  end if;
  c := case when coalesce(p ->> 'cau', '') ~ '^[0-9]{1,3}$' then (p ->> 'cau')::int end;
  insert into public.muse_bao_loi (mo_ta, de, ky_nang, part, cau, nguon)
  values (left(m, 2000), left(nullif(btrim(p ->> 'de'), ''), 200), left(nullif(btrim(p ->> 'ky_nang'), ''), 40),
          left(nullif(btrim(p ->> 'part'), ''), 40), c, left(nullif(btrim(p ->> 'nguon'), ''), 1000))
  returning id into new_id;
  insert into public.muse_calls (fn, ok, added) values ('bao_loi', true, 1);
  return jsonb_build_object('da_ghi', true, 'ma_bao_loi', new_id);
end $$;

revoke all on function public.muse_cong_kiem(text, text), public.muse_bao_loi(jsonb, text) from public;
grant execute on function public.muse_cong_kiem(text, text), public.muse_bao_loi(jsonb, text) to anon, authenticated;

-- HOÀN TÁC:
-- drop function if exists public.muse_cong_kiem(text, text), public.muse_bao_loi(jsonb, text);
-- drop table if exists public.muse_bao_loi;
