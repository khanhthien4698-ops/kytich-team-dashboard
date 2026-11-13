#!/usr/bin/env node
// Thử kết nối Muse trên bản thật (SQL 010), rồi dọn dòng thử. Không in mã ra màn hình.
//   node scripts/muse-thu.mjs        # gọi thử 3 hàm như Muse sẽ gọi (mã thử đọc từ file trên máy)
//   node scripts/muse-thu.mjs --don  # xoá đúng các dòng thử (mã bài 999900000000000x, nguồn muse) bằng tài khoản bot
// File mã thử: ~/Library/Application Support/kytich-bot/muse-test-key.txt (Thiện tự lưu, không đưa lên git).
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const f of ['.env', '.env.local']) {
  const p = join(ROOT, f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY
const T = 'https://www.facebook.com/groups/'
const TEST = '%/posts/99990000000000%'

if (process.argv.includes('--don')) {
  const email = 'bot@' + (env.VITE_LOGIN_DOMAIN || 'aptiskytich.vn')
  const pw = execFileSync('security', ['find-generic-password', '-s', 'kytich-dashboard-bot', '-a', email, '-w'], { encoding: 'utf8' }).trim()
  const sb = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await sb.auth.signInWithPassword({ email, password: pw })
  if (error) throw error
  for (const t of ['seed_targets', 'group_reviews', 'group_listening']) {
    const r = await sb.from(t).delete().like('url', TEST).eq('source', 'muse').select('url')
    console.log(`Xoá ${t}: ${r.error ? 'LỖI ' + r.error.message : r.data.length + ' dòng'} ${r.data?.map((x) => x.url).join(' ') || ''}`)
  }
  process.exit(0)
}

const keyFile = join(homedir(), 'Library/Application Support/kytich-bot/muse-test-key.txt')
const KEY = readFileSync(keyFile, 'utf8').trim()
if (!/^muse_[0-9a-f]{48}$/.test(KEY)) { console.log('File mã thử không đúng dạng muse_…'); process.exit(1) }
const call = async (fn, items, key = KEY) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', 'x-muse-key': key }, body: JSON.stringify({ items }) })
  return `${r.status} ${await r.text()}`
}
console.log('1) Mã sai (phải bị chặn):', await call('muse_them_review', [], 'muse_sai_ma_thu'))
console.log('2) Bài cần trả lời (mong: thêm 1, trùng 1, lỗi 2):', await call('muse_them_bai_can_tra_loi', [
  { url: T + '1551779633112657/posts/9999000000000001/', question: '[THỬ MUSE] bài mới dạng số, sẽ xoá', angle: 'thử' },
  { url: T + 'hoireviewdeaptis/posts/9999000000000001/?comment_id=1', question: '[THỬ MUSE] cùng bài, dạng tên → trùng' },
  { url: T + '1454470652574488', question: '[THỬ MUSE] link sai' },
  { url: T + '249824803065349/posts/9999000000000009/', question: '[THỬ MUSE] group không seeding' },
]))
console.log('3) Review (mong: thêm 1, trùng 1):', await call('muse_them_review', [
  { url: T + 'hoireviewdeaptis/posts/9999000000000002/', group: 'Hội review đề Aptis có tâm', posted_at: '13/11 10:00', exam_date: '13/11', shift: 'sáng', location: 'không rõ', content: '[THỬ MUSE] nội dung đề thử nghiệm, sẽ xoá ngay sau khi thử xong.' },
  { url: T + '1551779633112657/posts/9999000000000002/', content: '[THỬ MUSE] cùng bài dạng số, phải báo trùng ở đây.' },
]))
console.log('4) Lắng nghe (mong: thêm 1, trùng 1, lỗi 1):', await call('muse_them_lang_nghe', [
  { kind: 'ky_tich', level: '🟡', author: 'Ẩn danh', quote: '[THỬ MUSE] câu trích thử', sentiment: 'hỏi', url: T + '1454470652574488/posts/9999000000000003/' },
  { kind: 'ky_tich', level: 'vua', quote: '[THỬ MUSE] câu trích thử', url: T + '1454470652574488/permalink/9999000000000003/' },
  { kind: 'sai', level: 'cao', quote: 'xxx', url: T + '1454470652574488/posts/9999000000000003/' },
]))
