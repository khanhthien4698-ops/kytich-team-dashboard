// muse-cong: cổng duy nhất cho Muse vai "trực trả lời học viên" (Thiện duyệt 27/11/2026, SQL 019).
// Muse gửi POST JSON { "viec": "...", ... } với header x-muse-key = mã Muse (tab Cài đặt của dashboard).
//   tra_tai_khoan { tim: email hoặc SĐT }                        → gói, hạn, 3 đơn gần nhất (không trả tên/SĐT/email)
//   tra_cau_de    { de, ky_nang, part, cau? }                    → câu hỏi, lựa chọn, đáp án, giải thích
//   bao_loi       { mo_ta, de?, ky_nang?, part?, cau?, nguon? }  → hàng chờ muse_bao_loi
//   bao_zalo      { noi_dung }                                   → 1 tin cho Thiện qua bot Zalo (5 tin/giờ, 20 tin/ngày)
//   tom_tat_web   {}                                             → số đếm lỗi web 2 giờ qua (không dữ liệu học viên)
//   lay_bai_can_cham { days? }                                   → bài/comment seeding chưa chấm (hôm qua + bù 3 ngày), như lệnh bot to-review
//   ghi_cham      { date?, reviews: [...], feedback: [...] }     → ghi điểm chấm + nhận xét, như lệnh bot reviews
// Muse không cầm mã nào khác. Secret của function (Supabase → Edge Functions → Secrets):
//   KT_CONG_KEY   mã cổng DB web Kỳ Tích (DB bên đó chỉ giữ mã băm)
//   ZALO_BOT_TOKEN, ZALO_CHAT_ID   bot Zalo kytich, người nhận thien
// Deploy: Supabase → Edge Functions → Deploy new function → tên "muse-cong" → dán file này → TẮT "Verify JWT".
import { createClient } from 'npm:@supabase/supabase-js@2'
const V = 'muse-cong 2026-11-27b'
const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
// DB web Kỳ Tích: địa chỉ + anon key công khai (đã nằm sẵn trong mã web)
const KT_URL = 'https://bacoamhbatqpxatrrflz.supabase.co'
const KT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhY29hbWhiYXRxcHhhdHJyZmx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTgyODgsImV4cCI6MjA4ODY5NDI4OH0.BcFLY1mFlFxCK7E0E89iLlh4am3mEXkbYZaFJ4O_mpw'

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

async function rpc(base: string, anon: string, fn: string, body: unknown, extra: Record<string, string>) {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* giữ chữ */ }
  return { ok: r.ok, status: r.status, data }
}
const msgOf = (d: unknown) => (d && typeof d === 'object' && 'message' in d ? String((d as { message: unknown }).message) : String(d))
const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
// Bảng dashboard: dùng service role (chỉ sau khi đã kiểm mã Muse), chỉ đọc/ghi đúng các bảng seeding
const admin = () => createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// Như lệnh bot to-review: hôm qua + bài CHƯA CHẤM của 3 ngày trước
async function layBaiCanCham(days: number) {
  const sb = admin()
  const day = addDays(vnToday(), -1), from = addDays(day, -Math.min(7, Math.max(0, days)))
  const { data: posts, error } = await sb.from('seeding_posts').select('id,member_id,date,created_at,url,group_name,kind,question,idea_id,target_id').gte('date', from).lte('date', day).order('created_at')
  if (error) throw error
  const ids = posts.map((p) => p.id)
  const done = ids.length ? (await sb.from('seeding_reviews').select('post_id').in('post_id', ids)).data ?? [] : []
  const doneSet = new Set(done.map((r) => r.post_id))
  const members = (await sb.from('members').select('id,name')).data ?? []
  const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name]))
  const tIds = [...new Set(posts.map((p) => p.target_id).filter(Boolean))]
  const said = tIds.length ? Object.fromEntries(((await sb.from('seed_targets').select('id,comment_text').in('id', tIds)).data ?? []).map((t) => [t.id, t.comment_text])) : {}
  const ideaIds = [...new Set(posts.map((p) => p.idea_id).filter(Boolean))]
  const ideas = ideaIds.length ? (await sb.from('seed_ideas').select('id,topic').in('id', ideaIds)).data ?? [] : []
  const list = posts.filter((p) => !doneSet.has(p.id)).map((p) => ({
    post_id: p.id, member: nameOf[p.member_id], date: p.date, url: p.url, group: p.group_name, kind: p.kind,
    question: p.question || null, idea_topic: ideas.find((i) => i.id === p.idea_id)?.topic || null,
    comment_text: p.target_id ? said[p.target_id] || null : null,
  }))
  return { tu_ngay: from, den_ngay: day, tong_bai: posts.length, can_cham: list.length, bai: list }
}

// Như lệnh bot reviews (kiểm y hệt)
async function ghiCham(b: Record<string, unknown>) {
  const sb = admin()
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : addDays(vnToday(), -1)
  const STATUS = ['live', 'hidden', 'removed', 'pending', 'unreachable']
  const FLAGS = ['dong_vai_hoc_vien', 'chep_tin_khach', 'spam_link', 'sai_group', 'van_mau']
  const int = (v: unknown, k: string) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new Error(`"${k}" phải là số nguyên ≥ 0 hoặc null`)
    return n
  }
  const raw = Array.isArray(b.reviews) ? b.reviews as Record<string, unknown>[] : []
  if (raw.length > 100) throw new Error('Tối đa 100 review mỗi lần')
  const reviews = raw.map((r) => {
    if (!r.post_id) throw new Error('Mỗi review cần post_id (lấy từ lay_bai_can_cham)')
    if (!STATUS.includes(String(r.status))) throw new Error('status phải là: ' + STATUS.join(', '))
    const flags = Array.isArray(r.rule_flags) ? r.rule_flags.map(String) : []
    const bad = flags.filter((f) => !FLAGS.includes(f))
    if (bad.length) throw new Error('rule_flags không hợp lệ: ' + bad.join(', '))
    const score = r.score == null ? null : Number(r.score)
    if (score != null && !(Number.isInteger(score) && score >= 1 && score <= 5)) throw new Error('score phải 1-5')
    const txt = (v: unknown) => (v ? String(v).slice(0, 1000) : null)
    return {
      post_id: String(r.post_id), checked_at: new Date().toISOString(), status: String(r.status),
      reactions: int(r.reactions, 'reactions'), comments: int(r.comments, 'comments'), shares: int(r.shares, 'shares'),
      asker_replied: typeof r.asker_replied === 'boolean' ? r.asker_replied : null,
      score, good: txt(r.good), improve: txt(r.improve), suggestion: txt(r.suggestion), rule_flags: flags,
    }
  })
  const members = (await sb.from('members').select('id,name')).data ?? []
  const fbRaw = Array.isArray(b.feedback) ? b.feedback as Record<string, unknown>[] : []
  const feedback = fbRaw.map((f) => {
    if (!f.text) throw new Error('Mỗi feedback cần text')
    const m = members.find((x) => x.name === f.member)
    if (!m) throw new Error('Không có người tên ' + f.member)
    return { date: typeof f.date === 'string' ? f.date : date, member_id: m.id, text: String(f.text).slice(0, 2000) }
  })
  if (reviews.length) {
    const ok = new Set(((await sb.from('seeding_posts').select('id').in('id', reviews.map((r) => r.post_id))).data ?? []).map((x) => x.id))
    const miss = reviews.filter((r) => !ok.has(r.post_id))
    if (miss.length) throw new Error('post_id không có trên dashboard: ' + miss.map((r) => r.post_id).join(', '))
    const { error } = await sb.from('seeding_reviews').upsert(reviews, { onConflict: 'post_id' })
    if (error) throw error
  }
  if (feedback.length) {
    const { error } = await sb.from('member_feedback').upsert(feedback, { onConflict: 'date,member_id' })
    if (error) throw error
  }
  return { da_ghi_cham: reviews.length, da_ghi_nhan_xet: feedback.length, ngay: date }
}

const ghiKt = (fn: string, ok: boolean, note?: string) =>
  rpc(KT_URL, KT_ANON, 'muse_cong_ghi', { p_fn: fn, p_ok: ok, p_note: note ?? null }, { 'x-cong-key': Deno.env.get('KT_CONG_KEY') ?? '' }).catch(() => null)

Deno.serve(async (req) => {
  if (req.method === 'GET') return out({ v: V, cach_dung: 'POST JSON {viec: tra_tai_khoan | tra_cau_de | bao_loi | bao_zalo, ...} + header x-muse-key' })
  if (req.method !== 'POST') return out({ loi: 'Chỉ nhận POST' }, 405)
  const key = req.headers.get('x-muse-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!key) return out({ loi: 'Thiếu header x-muse-key' }, 401)
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return out({ loi: 'Body phải là JSON' }, 400) }
  const viec = String(b.viec ?? '')
  const mk = { 'x-muse-key': key }

  if (viec === 'bao_loi') {
    const { viec: _v, ...p } = b
    const r = await rpc(URL, ANON, 'muse_bao_loi', { p }, mk)
    return r.ok ? out(r.data) : out({ loi: msgOf(r.data) }, r.status)
  }
  const VIEC = ['tra_tai_khoan', 'tra_cau_de', 'bao_zalo', 'tom_tat_web', 'lay_bai_can_cham', 'ghi_cham']
  if (!VIEC.includes(viec)) return out({ loi: 'viec phải là bao_loi hoặc ' + VIEC.join(', ') }, 400)
  // Kiểm mã Muse + giới hạn + ghi nhật ký ở DB dashboard
  const gate = await rpc(URL, ANON, 'muse_cong_kiem', { p_fn: viec }, mk)
  if (!gate.ok) return out({ loi: msgOf(gate.data) }, gate.status === 400 ? 403 : gate.status)

  if (viec === 'bao_zalo') {
    const text = String(b.noi_dung ?? '').trim()
    if (text.length < 2) return out({ loi: 'Thiếu noi_dung' }, 400)
    const token = Deno.env.get('ZALO_BOT_TOKEN'), chat = Deno.env.get('ZALO_CHAT_ID')
    if (!token || !chat) return out({ loi: 'Cổng chưa cài bot Zalo' }, 500)
    const r = await fetch(`https://bot-api.zaloplatforms.com/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: ('[Muse] ' + text).slice(0, 1800) }),
    })
    const j = await r.json().catch(() => ({}))
    return j?.ok ? out({ da_gui: true }) : out({ loi: 'Zalo không nhận tin', ma: j?.error_code ?? r.status }, 502)
  }

  if (viec === 'lay_bai_can_cham' || viec === 'ghi_cham') {
    try {
      return out(viec === 'ghi_cham' ? await ghiCham(b) : await layBaiCanCham(b.days == null ? 3 : Number(b.days) || 3))
    } catch (e) { return out({ loi: e instanceof Error ? e.message : msgOf(e) }, 400) }
  }

  const ck = { 'x-cong-key': Deno.env.get('KT_CONG_KEY') ?? '' }
  const r = viec === 'tom_tat_web'
    ? await rpc(KT_URL, KT_ANON, 'muse_tom_tat_web', {}, ck)
    : viec === 'tra_tai_khoan'
    ? await rpc(KT_URL, KT_ANON, 'muse_tra_tai_khoan', { p_tim: String(b.tim ?? '') }, ck)
    : await rpc(KT_URL, KT_ANON, 'muse_tra_cau_de', {
        p_de: String(b.de ?? ''), p_ky_nang: String(b.ky_nang ?? ''), p_part: String(b.part ?? ''),
        p_cau: b.cau == null || b.cau === '' ? null : Number(b.cau),
      }, ck)
  const kq = r.ok && r.data && typeof r.data === 'object' ? String((r.data as { ket_qua?: unknown }).ket_qua ?? '') : 'loi'
  await ghiKt(viec, r.ok, kq)
  return r.ok ? out(r.data) : out({ loi: msgOf(r.data) }, 502)
})
