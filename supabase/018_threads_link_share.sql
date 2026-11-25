-- 018: Kho bài EPIX nhận thêm link chia sẻ Threads dạng https://www.threads.com/share/MÃ (Thiện báo lỗi 25/11/2026)
-- Threads bản máy tính bấm "Sao chép liên kết" ra link /share/MÃ, không có tên nick.
-- Vẫn giữ dạng cũ /@nick/post/MÃ. Một link chia sẻ chỉ được ghi cho một bài trong kho.
-- Chạy lại nhiều lần vẫn an toàn. Không xoá dữ liệu.

alter table public.threads_kho_dang drop constraint if exists threads_kho_dang_link_dang;
alter table public.threads_kho_dang add constraint threads_kho_dang_link_dang
  check (link is null
    or link ~ '^https://www\.threads\.com/@[A-Za-z0-9._]{1,40}/post/[A-Za-z0-9_-]{5,40}$'
    or link ~ '^https://www\.threads\.com/share/[A-Za-z0-9_-]{5,40}$') not valid;

create unique index if not exists threads_kho_dang_ma_share_threads
  on public.threads_kho_dang ((substring(link from '/share/([A-Za-z0-9_-]+)$')))
  where link is not null;
