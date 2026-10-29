-- Kiểm thử RLS migration 002 trên Postgres cục bộ (chạy sau test_rls.sql). Không chạy trên Supabase thật.
\set ON_ERROR_STOP 0
create or replace function pg_temp.as_user(email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', email)::text, false);
  execute 'set role authenticated';
end $$;
reset role;
insert into seeding_posts (member_id, url, kind) select id, 'https://fb.com/tv2', 'post' from members where name='Thành viên 2';

select pg_temp.as_user('bot@aptiskytich.vn');
\echo '--- Bot ghi review cho 2 bài + feedback (kỳ vọng OK):'
insert into seeding_reviews (post_id, status, reactions, score, good, rule_flags)
  select id, 'live', 12, 4, 'Mở bài tốt', '{}' from seeding_posts;
insert into member_feedback (date, member_id, text) select vn_today(), id, 'Nhận xét' from members where role='staff';
\echo '--- Bot ghi rule_flag lạ (kỳ vọng LỖI check):'
insert into seeding_reviews (post_id, status, rule_flags) select id, 'live', '{abc}' from seeding_posts limit 1;
reset role;

select pg_temp.as_user('thanhvien1@aptiskytich.vn');
\echo '--- TV1 thấy review/feedback (kỳ vọng 1, 1):'
select (select count(*) from seeding_reviews), (select count(*) from member_feedback);
\echo '--- TV1 sửa điểm review (kỳ vọng 0 dòng), ghi review (LỖI):'
update seeding_reviews set score = 5;
insert into seeding_reviews (post_id, status) select id, 'live' from seeding_posts limit 1;
reset role;

select pg_temp.as_user('thien@aptiskytich.vn');
\echo '--- Admin thấy review/feedback (kỳ vọng 2, 3):'
select (select count(*) from seeding_reviews), (select count(*) from member_feedback);
reset role;
