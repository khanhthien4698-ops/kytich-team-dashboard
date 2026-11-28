-- 022: lịch báo cáo cổ đông máy chủ, đặt lại với thời gian chờ 60 giây (hàm có thử lại Zalo, 28/11/2026). Giờ giữ nguyên 8h00-8h50 VN.
select cron.unschedule('lich-zalo-co-dong') where exists (select 1 from cron.job where jobname = 'lich-zalo-co-dong');
select cron.schedule('lich-zalo-co-dong', '0,10,20,30,40,50 1 * * *',
  $$select net.http_post('https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/lich-zalo', '{"loai":"co_dong"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 60000)$$);
select jobname, schedule, command like '%60000%' as cho_60s from cron.job where jobname like 'lich-zalo%' order by jobname;
