-- 020: Máy chủ tự gửi tin Zalo theo giờ (Thiện duyệt 27/11/2026), không cần máy Thiện bật.
--   Edge function lich-zalo (supabase/functions/lich-zalo): seeding nhóm Team 11h30/17h/22h, báo cáo cổ đông 8h.
--   Bảng lich_zalo_gui: mỗi khung giờ 1 dòng, chống gửi trùng. Chỉ chủ + bot đọc.
--   pg_cron gọi edge function bằng pg_net (giờ cron là UTC: VN = UTC+7).
-- Chạy song song bản cũ trên máy: chưa cài secret ZALO_TEAM_ID / ZALO_CODONG_ID thì bản máy chủ chỉ gửi riêng Thiện.
-- Chạy lại nhiều lần vẫn an toàn. Hoàn tác ở cuối file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.lich_zalo_gui (
  loai       text not null check (loai in ('seeding', 'co_dong')),
  slot       text not null,                -- seeding: YYYY-MM-DD-<phút trong ngày>; co_dong: YYYY-MM-DD
  trang_thai text not null check (trang_thai in ('dang_gui', 'da_gui', 'giu_lai', 'loi')),
  ghi_chu    text,
  luc        timestamptz not null default now(),
  primary key (loai, slot)
);
alter table public.lich_zalo_gui enable row level security;
alter table public.lich_zalo_gui force row level security;
revoke all on public.lich_zalo_gui from anon, public;
grant select on public.lich_zalo_gui to authenticated;
drop policy if exists lich_zalo_gui_read on public.lich_zalo_gui;
create policy lich_zalo_gui_read on public.lich_zalo_gui for select to authenticated using (public.is_owner() or public.is_bot());

-- Lịch (UTC). seeding: 11h30, 17h, 22h VN + 1 lần gọi bù 20 phút sau mỗi khung. co_dong: 8h00-8h50 VN, mỗi 10 phút.
do $$
declare j text;
begin
  foreach j in array array['lich-zalo-seeding', 'lich-zalo-seeding-bu', 'lich-zalo-seeding-17-22', 'lich-zalo-co-dong'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;
select cron.schedule('lich-zalo-seeding', '30 4 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb)$$);
select cron.schedule('lich-zalo-seeding-bu', '50 4 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb)$$);
select cron.schedule('lich-zalo-seeding-17-22', '0,20 10,15 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb)$$);
select cron.schedule('lich-zalo-co-dong', '0,10,20,30,40,50 1 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"co_dong"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb)$$);

-- HOÀN TÁC:
-- select cron.unschedule(j) from unnest(array['lich-zalo-seeding','lich-zalo-seeding-bu','lich-zalo-seeding-17-22','lich-zalo-co-dong']) j;
-- drop table if exists public.lich_zalo_gui;
