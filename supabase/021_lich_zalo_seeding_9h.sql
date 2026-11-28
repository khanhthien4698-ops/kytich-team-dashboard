-- 021: báo seeding máy chủ thêm lượt 9h sáng (Thiện chốt 28/11/2026), thành 9h, 11h30, 17h, 22h.
-- Đặt lại cả 3 lịch seeding với thời gian chờ 60 giây (hàm có thử lại Zalo 3 lần, mất tới ~25 giây).
-- Lịch UTC: 9h VN = 2h UTC, lượt bù 20 phút sau. Lịch cổ đông giữ nguyên.
do $$
declare j text;
begin
  foreach j in array array['lich-zalo-seeding-9h', 'lich-zalo-seeding', 'lich-zalo-seeding-bu', 'lich-zalo-seeding-17-22'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;
select cron.schedule('lich-zalo-seeding-9h', '0,20 2 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 60000)$$);
select cron.schedule('lich-zalo-seeding', '30 4 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 60000)$$);
select cron.schedule('lich-zalo-seeding-bu', '50 4 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 60000)$$);
select cron.schedule('lich-zalo-seeding-17-22', '0,20 10,15 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"seeding"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 60000)$$);
select jobname, schedule from cron.job where jobname like 'lich-zalo%' order by jobname;

-- HOÀN TÁC lượt 9h: select cron.unschedule('lich-zalo-seeding-9h');
