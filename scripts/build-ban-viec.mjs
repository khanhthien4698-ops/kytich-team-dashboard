// Ghép trang Bàn việc gốc (scripts/ban-viec-goc.html, chỉ có code, không có dữ liệu) với lớp nối Supabase
// (scripts/ban-viec-shim.js) thành public/ban-viec.html. Trang gốc đổi thì chép bản mới vào ban-viec-goc.html rồi chạy lại:
//   node scripts/build-ban-viec.mjs
import { readFileSync, writeFileSync } from 'fs'
const goc = readFileSync(new URL('./ban-viec-goc.html', import.meta.url), 'utf8')
const shim = readFileSync(new URL('./ban-viec-shim.js', import.meta.url), 'utf8')
const i = goc.indexOf('<body>')
if (i < 0) throw new Error('Không thấy <body> trong ban-viec-goc.html')
const head = '<title>Bàn việc của Thiện</title><meta name="robots" content="noindex">'
// Trang cũ nhắc đăng nhập claude.ai; trong dashboard thì nhắc đăng nhập tài khoản Thiện
const goc2 = goc.replace('Mở trang khi đã đăng nhập claude.ai để xem và tick việc.', 'Mở trong dashboard Team Aptis Kỳ Tích, đăng nhập tài khoản Thiện để xem và tick việc.')
const out = goc2.slice(0, i).replace('</head>', head + '</head>') + '<body>\n<script>\n' + shim + '\n</script>\n' + goc2.slice(i + 6)
writeFileSync(new URL('../public/ban-viec.html', import.meta.url), out)
console.log('OK: public/ban-viec.html (' + out.length + ' ký tự)')
