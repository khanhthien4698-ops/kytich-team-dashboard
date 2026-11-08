-- 007: Chia bài cần trả lời An 50% · Châu 50% (Thiện chốt 08/11/2026)
-- Bot chia bài theo ô "cmt/ngày" ở tab Cài đặt (cột comment_quota): ai có số lớn hơn được nhiều bài hơn.
-- Đặt An = Châu = 10 → chia đều. Sau này Thiện tự đổi ở tab Cài đặt, không cần SQL.
update public.members set comment_quota = 10
where lower(login_email) in ('dag@aptiskytich.vn', 'nnmc@aptiskytich.vn');

select name, comment_quota from public.members where role = 'staff' and active order by sort_order;
