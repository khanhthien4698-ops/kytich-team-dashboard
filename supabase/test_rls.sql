-- Kiểm thử RLS trên Postgres cục bộ (không chạy trên Supabase thật).
\set ON_ERROR_STOP 0
create or replace function pg_temp.as_user(email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', email)::text, false);
  execute 'set role authenticated';
end $$;

-- Thành viên 1 tick việc + ghi seeding
select pg_temp.as_user('thanhvien1@aptiskytich.vn');
insert into daily_checks (member_id, routine_id, done)
  select my_member_id(), id, true from routines where member_id = my_member_id() limit 1;
insert into seeding_posts (member_id, url, group_name, kind) values (my_member_id(), 'https://facebook.com/groups/x/1', 'G1', 'post');
\echo '--- TV1 thấy bao nhiêu check (kỳ vọng 1):'
select count(*) from daily_checks;
\echo '--- TV1 ghi hộ TV2 (kỳ vọng LỖI RLS):'
insert into seeding_posts (member_id, url, kind) select id, 'https://x.com', 'post' from members where name='Thành viên 2';
\echo '--- TV1 link không http (kỳ vọng LỖI check):'
insert into seeding_posts (member_id, url, kind) values (my_member_id(), 'abc', 'post');
\echo '--- TV1 sửa members (kỳ vọng 0 dòng):'
update members set role='admin' where login_email='thanhvien1@aptiskytich.vn';
\echo '--- TV1 tạo seed_idea (kỳ vọng LỖI RLS):'
insert into seed_ideas (topic) values ('hack');
\echo '--- TV1 đọc team_reports (kỳ vọng 0):'
select count(*) from team_reports;
reset role;

-- TV2 không thấy dữ liệu TV1
select pg_temp.as_user('thanhvien2@aptiskytich.vn');
\echo '--- TV2 thấy check/seeding của người khác (kỳ vọng 0, 0):'
select (select count(*) from daily_checks), (select count(*) from seeding_posts);
\echo '--- TV2 đọc routines của người khác (kỳ vọng 3 = của mình):'
select count(*) from routines;
reset role;

-- Bot ghi báo cáo + ý tưởng
select pg_temp.as_user('bot@aptiskytich.vn');
insert into team_reports (text) values ('Báo cáo thử');
insert into seed_ideas (topic, question) values ('Speaking part 4', 'Làm sao nói đủ 2 phút?');
\echo '--- Bot đọc check/seeding của mọi người (kỳ vọng 1, 1):'
select (select count(*) from daily_checks), (select count(*) from seeding_posts);
\echo '--- Bot ghi daily_checks (kỳ vọng LỖI RLS):'
insert into daily_checks (member_id, routine_id) select member_id, id from routines limit 1;
reset role;

-- "Mình lấy": TV1 lấy được, TV2 lấy trùng thì false
select pg_temp.as_user('thanhvien1@aptiskytich.vn');
\echo '--- TV1 take (kỳ vọng t):'
select take_idea(id) from seed_ideas limit 1;
reset role;
select pg_temp.as_user('thanhvien2@aptiskytich.vn');
\echo '--- TV2 take trùng (kỳ vọng f), release thẻ người khác (kỳ vọng f):'
select take_idea(id), release_idea(id) from seed_ideas limit 1;
reset role;

-- Admin thấy hết
select pg_temp.as_user('thien@aptiskytich.vn');
\echo '--- Admin thấy check/seeding/report (kỳ vọng 1,1,1):'
select (select count(*) from daily_checks), (select count(*) from seeding_posts), (select count(*) from team_reports);
reset role;

-- Người lạ (đăng nhập nhưng chưa có trong members)
select pg_temp.as_user('la@gmail.com');
\echo '--- Người lạ đọc members/seed_ideas (kỳ vọng 0,0):'
select (select count(*) from members), (select count(*) from seed_ideas);
reset role;
set role anon;
\echo '--- anon đọc members (kỳ vọng LỖI permission):'
select count(*) from members;
reset role;
