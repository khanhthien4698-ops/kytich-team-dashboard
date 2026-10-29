// Chế độ DEMO (npm run demo): giả lập một phần API Supabase trong bộ nhớ trình duyệt,
// để xem giao diện khi chưa có project Supabase. Không dùng cho thật.
import { vnToday, addDays } from './date.js'

const uid = () => crypto.randomUUID()
const today = vnToday()
const DOMAIN = 'aptiskytich.vn'

function seed() {
  const m = (name, login, role, quota, sort) => ({ id: uid(), name, login_email: `${login}@${DOMAIN}`, role, seeding_quota: quota, active: true, sort_order: sort })
  const members = [
    m('Thiện', 'thien', 'admin', 0, 0),
    m('Thành viên 1', 'thanhvien1', 'staff', 5, 1),
    m('Thành viên 2', 'thanhvien2', 'staff', 5, 2),
    m('Thành viên 3', 'thanhvien3', 'staff', 5, 3),
    m('Bot sáng', 'bot', 'bot', 0, 99),
  ]
  const staff = members.filter((x) => x.role === 'staff')
  const routines = []
  for (const s of staff)
    ['Xem gợi ý nội dung hôm nay, nhận thẻ', 'Trả lời tin nhắn / comment trên page', 'Ghi lại câu hỏi hay của học viên'].forEach((title, i) =>
      routines.push({ id: uid(), member_id: s.id, title, note: i === 2 ? 'Ghi vào file chung' : null, sort_order: i + 1, active: true }))
  const groups = ['Cộng đồng ôn thi Aptis', 'Aptis ESOL - Chia sẻ đề thi', 'Luyện thi Aptis B1 B2', 'Hội sinh viên thi Aptis'].map((name, i) => ({ id: uid(), name, url: 'https://facebook.com/groups/demo' + i, active: true, sort_order: i }))
  const daily_checks = [], seeding_posts = [], extra_tasks = [], day_notes = []
  // 7 ngày qua: TV1 chăm, TV2 lưng chừng, TV3 có ngày bỏ
  for (let k = 7; k >= 0; k--) {
    const date = addDays(today, -k)
    staff.forEach((s, si) => {
      const rs = routines.filter((r) => r.member_id === s.id)
      const doneN = k === 0 ? [2, 1, 0][si] : si === 0 ? 3 : si === 1 ? 2 : k % 3 === 0 ? 0 : 3
      const postN = k === 0 ? [3, 5, 0][si] : si === 0 ? 5 : si === 1 ? 3 : k % 3 === 0 ? 0 : 5
      rs.forEach((r, i) => daily_checks.push({ id: uid(), date, member_id: s.id, routine_id: r.id, done: i < doneN, note: null }))
      for (let p = 0; p < postN; p++) {
        const g = groups[(p + si) % groups.length]
        seeding_posts.push({ id: uid(), date, member_id: s.id, url: `https://facebook.com/groups/demo/posts/${k}${si}${p}`, group_id: g.id, group_name: g.name, kind: p % 2 ? 'comment' : 'post', idea_id: null, created_at: new Date(Date.now() - k * 864e5 - p * 36e5).toISOString() })
      }
      if (k > 0 && doneN) day_notes.push({ id: uid(), date, member_id: s.id, note: 'Hôm nay group Aptis ESOL tương tác tốt.' })
    })
  }
  extra_tasks.push({ id: uid(), date: today, member_id: staff[0].id, title: 'Soạn bài tổng hợp đề Speaking tuần này', done: false })
  const topics = [
    ['Speaking Part 4 — nói đủ 2 phút', 'Làm sao để nói đủ 2 phút ở Part 4 mà không bị bí ý?', 'Chia sẻ khung 4 bước: quan điểm → lý do → ví dụ → kết', 'File khung Speaking Part 4'],
    ['Writing Part 4 — email trang trọng', 'Email trang trọng và thân mật khác nhau ở những điểm nào?', 'Bảng so sánh 2 cột, 6 cụm mở/kết', 'Mẫu email Writing Part 4'],
    ['Lịch thi tháng 11', 'Đăng ký thi Aptis tháng tới ở đâu, mất bao lâu có kết quả?', 'Tổng hợp lịch + mốc trả kết quả', 'Lịch thi tháng 11 (ảnh)'],
    ['Listening Part 2 — bẫy từ đồng nghĩa', 'Vì sao nghe được từ khoá mà vẫn chọn sai?', 'Giải thích bẫy paraphrase, kèm 3 ví dụ', 'Bộ 20 câu Listening Part 2'],
  ]
  const seed_ideas = topics.map(([topic, question, angle, gift_doc], i) => ({ id: uid(), date: today, topic, question, angle, gift_doc, assigned_to: staff[i % 3].id, taken_by: i === 0 ? staff[0].id : i === 1 ? staff[1].id : null, taken_at: null }))
  const team_reports = [
    { id: uid(), date: today, member_id: null, text: 'Hôm qua: Thành viên 1 đủ việc 3/3, seeding 5/5. Thành viên 2 việc 2/3, seeding 3/5 (thiếu 2). Thành viên 3 chưa ghi gì.\nTrung bình 7 ngày: 4,1 bài/người/ngày.', created_at: new Date().toISOString() },
    { id: uid(), date: today, member_id: staff[1].id, text: 'Hôm qua bạn làm 2/3 việc, seeding 3/5. Hôm nay nhớ bù 2 bài nhé.', created_at: new Date().toISOString() },
  ]
  return { members, routines, seed_groups: groups, daily_checks, seeding_posts, extra_tasks, day_notes, seed_ideas, team_reports }
}

const db = seed()
let session = null
const listeners = new Set()

class Query {
  constructor(table) { this.t = table; this.filters = []; this.orders = []; this.op = 'select'; this.payload = null; this._one = false }
  select() { return this }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  ilike(c, v) { this.filters.push((r) => (r[c] || '').toLowerCase() === v.toLowerCase()); return this }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this }
  limit() { return this }
  insert(p) { this.op = 'insert'; this.payload = p; return this }
  update(p) { this.op = 'update'; this.payload = p; return this }
  upsert(p, o = {}) { this.op = 'upsert'; this.payload = p; this.conflict = (o.onConflict || 'id').split(','); return this }
  delete() { this.op = 'delete'; return this }
  single() { this._one = true; return this }
  maybeSingle() { this._one = true; return this }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej) }
  run() {
    const rows = db[this.t]
    const match = (r) => this.filters.every((f) => f(r))
    let out
    if (this.op === 'select') {
      out = rows.filter(match)
      for (const [c, asc] of [...this.orders].reverse()) out = [...out].sort((a, b) => ((a[c] ?? '') > (b[c] ?? '') ? 1 : (a[c] ?? '') < (b[c] ?? '') ? -1 : 0) * (asc ? 1 : -1))
    } else if (this.op === 'insert') {
      out = [].concat(this.payload).map((p) => ({ id: uid(), created_at: new Date().toISOString(), ...p }))
      rows.push(...out)
    } else if (this.op === 'update') {
      out = rows.filter(match)
      out.forEach((r) => Object.assign(r, this.payload))
    } else if (this.op === 'upsert') {
      out = [].concat(this.payload).map((p) => {
        const ex = rows.find((r) => this.conflict.every((c) => (r[c] ?? null) === (p[c] ?? null)))
        if (ex) return Object.assign(ex, p)
        const n = { id: uid(), ...p }
        rows.push(n)
        return n
      })
    } else if (this.op === 'delete') {
      out = rows.filter(match)
      db[this.t] = rows.filter((r) => !match(r))
    }
    out = out.map((r) => ({ ...r }))
    if (this._one) return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }
}
function me() { return db.members.find((m) => m.login_email === session?.user.email) }

export const demoClient = {
  from: (t) => new Query(t),
  async rpc(fn, { p_idea }) {
    const idea = db.seed_ideas.find((i) => i.id === p_idea)
    const m = me()
    if (fn === 'take_idea') { if (!idea || idea.taken_by) return { data: false, error: null }; idea.taken_by = m.id; idea.taken_at = new Date().toISOString(); return { data: true, error: null } }
    if (fn === 'release_idea') { if (!idea || (idea.taken_by !== m.id && m.role !== 'admin')) return { data: false, error: null }; idea.taken_by = null; return { data: true, error: null } }
    return { data: null, error: { message: 'rpc không có trong demo' } }
  },
  auth: {
    async signInWithPassword({ email }) {
      if (!db.members.some((m) => m.login_email === email)) return { data: null, error: { message: 'Invalid login credentials' } }
      session = { user: { email } }
      listeners.forEach((cb) => cb('SIGNED_IN', session))
      return { data: { session }, error: null }
    },
    async signOut() { session = null; listeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null } },
    async getSession() { return { data: { session } } },
    async updateUser() { return { error: { message: 'Demo không đổi mật khẩu' } } },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } } },
  },
}
