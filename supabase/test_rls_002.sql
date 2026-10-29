-- Kiểm thử migration 002 trên Postgres cục bộ (chạy sau 001 + test_rls.sql). Không chạy trên Supabase thật.
\set ON_ERROR_STOP 0
create or replace function pg_temp.as_user(email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', email)::text, false);
  execute 'set role authenticated';
end $$;
reset role;
insert into seeding_posts (member_id, url, kind) select id, 'https://fb.com/tv2', 'post' from members where name='Thành viên 2';

select pg_temp.as_user('bot@aptiskytich.vn');
\echo '--- Bot ghi review + feedback + 2 cơ hội (kỳ vọng OK):'
insert into seeding_reviews (post_id, status, reactions, score, good, rule_flags)
  select id, 'live', 12, 4, 'Mở bài tốt', '{}' from seeding_posts;
insert into member_feedback (date, member_id, text) select vn_today(), id, 'Nhận xét' from members where role='staff';
insert into seed_targets (url, group_name, question, angle) values
  ('https://fb.com/g/p/1', 'G1', 'Hỏi tài liệu Speaking', 'Chia sẻ khung'),
  ('https://fb.com/g/p/2', 'G1', 'Hỏi lịch thi', 'Gửi lịch');
\echo '--- Bot ghi rule_flag lạ (kỳ vọng LỖI check):'
insert into seeding_reviews (post_id, status, rule_flags) select id, 'live', '{abc}' from seeding_posts limit 1;
reset role;

select pg_temp.as_user('thanhvien1@aptiskytich.vn');
\echo '--- TV1 thấy review/feedback/targets (kỳ vọng 1, 1, 2):'
select (select count(*) from seeding_reviews), (select count(*) from member_feedback), (select count(*) from seed_targets);
\echo '--- TV1 ghi review (LỖI), sửa thẳng seed_targets (0 dòng), thêm target (LỖI):'
insert into seeding_reviews (post_id, status) select id, 'live' from seeding_posts limit 1;
update seed_targets set status = 'commented';
insert into seed_targets (url, question) values ('https://x.com', 'x');
\echo '--- TV1 nhận cơ hội 1 (kỳ vọng t):'
select take_target(id) from seed_targets where url like '%/1';
reset role;

select pg_temp.as_user('thanhvien2@aptiskytich.vn');
\echo '--- TV2 nhận trùng (f), bỏ qua thẻ người khác (f), comment vào thẻ người khác (LỖI):'
select take_target(id), set_target_status(id, 'skipped') from seed_targets where url like '%/1';
select complete_target(id, 'https://fb.com/c/9') from seed_targets where url like '%/1';
reset role;

select pg_temp.as_user('thanhvien1@aptiskytich.vn');
\echo '--- TV1 "Đã comment" link sai (LỖI), link đúng (ra uuid):'
select complete_target(id, 'abc') from seed_targets where url like '%/1';
select complete_target(id, 'https://fb.com/g/p/1?comment_id=5') is not null from seed_targets where url like '%/1';
\echo '--- TV1 có 1 dòng comment nối target, target = commented (kỳ vọng comment|t|commented):'
select p.kind, p.target_id is not null, t.status from seeding_posts p join seed_targets t on t.id = p.target_id;
\echo '--- TV1 bỏ qua cơ hội 2 chưa ai nhận (t):'
select set_target_status(id, 'skipped') from seed_targets where url like '%/2';
reset role;

select pg_temp.as_user('thien@aptiskytich.vn');
\echo '--- Admin thấy review/feedback/targets (kỳ vọng 2, 3, 2):'
select (select count(*) from seeding_reviews), (select count(*) from member_feedback), (select count(*) from seed_targets);
reset role;
