-- 016: Kho bài EPIX, link bài Threads bắt buộc đúng dạng và không trùng (Thiện chốt 25/11/2026 qua phiên 21)
-- Link hợp lệ: https://www.threads.com/@nick/post/MÃ (giao diện tự đổi threads.net, bỏ phần sau dấu ?).
-- Một bài Threads (cùng MÃ) chỉ được ghi cho một bài trong kho.
-- Dòng cũ không có link vẫn giữ (link được để trống ở DB), nhưng KPI chỉ đếm dòng có link.
-- Chạy lại nhiều lần vẫn an toàn. Không xoá dữ liệu.

alter table public.threads_kho_dang drop constraint if exists threads_kho_dang_link_check;
alter table public.threads_kho_dang drop constraint if exists threads_kho_dang_link_dang;
alter table public.threads_kho_dang add constraint threads_kho_dang_link_dang
  check (link is null or link ~ '^https://www\.threads\.com/@[A-Za-z0-9._]{1,40}/post/[A-Za-z0-9_-]{5,40}$') not valid;

create unique index if not exists threads_kho_dang_ma_bai_threads
  on public.threads_kho_dang ((substring(link from '/post/([A-Za-z0-9_-]+)$')))
  where link is not null;
