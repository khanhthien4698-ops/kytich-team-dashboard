// Kho hỏi đáp Zalo: gom mọi cặp "khách hỏi → Thiện trả lời" (nguyên văn) từ kho chat Zalo đã lưu,
// để bot luôn đổ đủ thẻ "Gợi ý bài đăng". Kho nằm trên máy (có chat khách), KHÔNG đưa vào repo.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ZALO_DIR = process.env.ZALO_DIR || join(homedir(), 'My Drive', 'Thienbk - Second brain', '04_Tài nguyên', 'Kho chat Zalo')
export const KHO_DIR = join(homedir(), 'Library', 'Application Support', 'kytich-bot')
export const KHO_FILE = join(KHO_DIR, 'kho-hoi-dap.json')
const ADMIN = 'Thiện'

// Dòng ảnh/sticker/trích dẫn không hiện được trên thẻ
const NOISE = /^(> ↩|\[(Sticker|Ảnh|Link|other|File|Video|Ghi âm)[^\]]*\]$)/
const strip = (t) => t.split('\n').filter((l) => l.trim() && !NOISE.test(l.trim())).join('\n')
  .replace(/\s*\[(Ảnh|Sticker|Link|File|Video)[^\]]*\]/g, '').trim()

// Che thông tin cá nhân còn sót (email, SĐT, số dài) — phần còn lại giữ nguyên văn
const redact = (t) => t
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[...]')
  .replace(/(\+?84|0)\d[\d .]{7,11}\d/g, '[...]')
  .replace(/\b\d{8,}\b/g, '[...]')
  .replace(/https?:\/\/(www\.)?(facebook|fb|zalo)\.\S+/gi, '[...]')

const SKIP_Q = /^(ok|oke|okela|dạ|da|vâng|uk|ừ|cảm ơn|cám ơn|thanks|tks|em cảm ơn|e cảm ơn|dạ vâng|dạ ok|dạ em cảm ơn|alo|hi|hello|chào)[\s.!ạa]*$/i
const ASKS = /\?|cho (e|em|mình|m|mik|t) hỏi|sao|không ạ|ko ạ|k ạ|kh ạ|hk ạ|được không|đc không|dc ko|bao giờ|bao lâu|bao nhiêu|ở đâu|thế nào|ntn|như nào|làm sao|có .* (không|ko|k|kh)\b|hả|nhỉ|đúng (k|không|ko)/i
// Hỏi/đáp dính tiền, tài khoản, quà review… thì không làm thẻ
const PRIVATE = /stk|số tài khoản|‹|chuyển khoản|\bck\b|hoàn tiền|mã giảm|KT-[A-Z0-9]|nhận quà|review|duyệt bài|đăng bài|gmail|mail|link bài/i
// Câu trả lời chỉ chào / cảm ơn / hỏi lại (aim, ngày thi, đã làm chưa…) thì chưa phải câu trả lời thật
const FILLER_LINE = /^(hi|hello|chào|dạ|vâng|ok|oke|ui|à|b iu|bạn|ạ|nha|nhé|nhứ|ợ|\W)*$|cảm ơn|ủng hộ|aim b|bao giờ b|b thi (khi|bao|ngày)|ad gửi (b )?hướng dẫn|chưa (ạ|á|b)?\??$|\?\s*$/i
const realAnswer = (a) => a.split('\n').map((l) => l.trim()).filter((l) => !FILLER_LINE.test(l)).join(' ').length >= 20

// Nhãn chủ đề: S/W/L/R viết hoa mới tính là kỹ năng
const TOPICS = [
  ['Speaking', /speak|\bnói\b/i, /\bS\b/], ['Writing', /writ|\bviết\b/i, /\bW\b/], ['Listening', /\blis|listen|\bnghe\b|wmb|bmw/i, /\bL\b/],
  ['Reading', /\bread|reading/i, /\bR\b/], ['Grammar & Vocab', /grammar|vocab|ngữ pháp|từ vựng/i, /\bG ?V\b/],
  ['Đi thi', /cccd|mang gì|mang theo|phòng thi|túi|điện thoại|đi sớm/i], ['Kết quả thi', /bằng cứng|chứng chỉ|kết quả|tra điểm|bản mềm|có điểm/i],
  ['Band điểm', /band|điểm|\b(a2|b1|b2|c1)\b/i], ['Key/đề', /key|đề|dự đoán|thần tốc|nhãn|lửa/i],
  ['Gói học', /gói|\bpro\b|mua|lượt|tài khoản|\btk\b/i],
]
const topicOf = (q) => TOPICS.find(([, re, cs]) => re.test(q) || cs?.test(q))?.[0] || 'Chung'
const norm = (q) => q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function buildKho() {
  if (!existsSync(ZALO_DIR)) throw new Error('Không thấy kho chat Zalo: ' + ZALO_DIR)
  const items = []
  for (const fn of readdirSync(ZALO_DIR).sort()) {
    if (!fn.endsWith('.md') || fn.startsWith('My Documents') || fn === 'Kho chat Zalo.md') continue
    const txt = readFileSync(join(ZALO_DIR, fn), 'utf8')
    if (!/kiểu: 1-1/.test(txt)) continue
    const thread = (txt.match(/thread-id: (\d+)/) || [])[1] || fn
    const msgs = []
    let day = null
    for (const line of txt.split('\n')) {
      const d = line.match(/^### .*?(\d\d)\/(\d\d)\/(\d{4})/)
      if (d) { day = `${d[3]}-${d[2]}-${d[1]}`; continue }
      if (!day) continue
      const m = line.match(/^- \*\*(\d\d:\d\d)\*\* (.+?): (.*)$/)
      if (m) { msgs.push({ at: `${day}T${m[1]}`, me: m[2] === ADMIN, text: m[3] }); continue }
      if (line.startsWith('  ') && msgs.length && !line.trim().startsWith('Cảm xúc:')) msgs[msgs.length - 1].text += '\n' + line.trim()
    }
    const turns = []
    for (const m of msgs) {
      const last = turns[turns.length - 1]
      if (last && last.me === m.me) last.lines.push(m.text)
      else turns.push({ me: m.me, at: m.at, lines: [m.text] })
    }
    turns.forEach((t, i) => {
      const next = turns[i + 1]
      if (t.me || !next?.me) return
      const q = strip(t.lines.join('\n'))
      const a = strip(next.lines.join('\n'))
      if (q.length < 12 || SKIP_Q.test(q) || !ASKS.test(q) || !a || !realAnswer(a)) return
      if (PRIVATE.test(q) || PRIVATE.test(a)) return
      const rq = redact(q)
      // Câu chỉ còn link/ảnh đã che (vd gửi kết quả) thì không phải câu hỏi
      if (rq.replace(/\[\.\.\.\]/g, '').replace(/\s+/g, ' ').trim().length < 12 || !ASKS.test(rq.replace(/\[\.\.\.\]/g, ''))) return
      items.push({ id: `${thread}-${t.at}`, at: t.at, topic: topicOf(q), q: rq, a: redact(a) })
    })
  }
  // Gộp câu hỏi trùng: giữ lần hỏi mới nhất, đếm số lần
  const byKey = new Map()
  for (const it of items.sort((x, y) => (x.at < y.at ? 1 : -1))) {
    const k = norm(it.q)
    if (byKey.has(k)) byKey.get(k).times++
    else byKey.set(k, { ...it, times: 1 })
  }
  const kho = [...byKey.values()]
  mkdirSync(KHO_DIR, { recursive: true })
  writeFileSync(KHO_FILE, JSON.stringify(kho, null, 1))
  // Bản CSV để mở bằng Excel/Numbers
  const csv = (s) => '"' + String(s).replace(/"/g, '""') + '"'
  writeFileSync(KHO_FILE.replace(/\.json$/, '.csv'), '\ufeff' + ['Ngày giờ,Chủ đề,Số lần hỏi,Câu hỏi,Câu trả lời', ...kho.map((k) => [k.at.replace('T', ' '), k.topic, k.times, k.q, k.a].map(csv).join(','))].join('\n'))
  return kho
}

// Chọn n câu để làm thẻ: câu chưa từng làm thẻ trước (mới nhất trước, xoay vòng chủ đề), hết thì lấy câu dùng lâu nhất
export function pickFromKho(kho, n, usedOn) {
  const fresh = kho.filter((k) => !usedOn.has(norm(k.q)))
  const old = kho.filter((k) => usedOn.has(norm(k.q))).sort((x, y) => (usedOn.get(norm(x.q)) < usedOn.get(norm(y.q)) ? -1 : 1))
  const out = []
  const buckets = new Map()
  for (const k of fresh.sort((x, y) => (y.times - x.times) || (x.at < y.at ? 1 : -1))) {
    if (!buckets.has(k.topic)) buckets.set(k.topic, [])
    buckets.get(k.topic).push(k)
  }
  while (out.length < n && [...buckets.values()].some((b) => b.length)) {
    for (const b of buckets.values()) if (b.length && out.length < n) out.push(b.shift())
  }
  for (const k of old) if (out.length < n) out.push(k)
  return out
}
export const normQ = norm
