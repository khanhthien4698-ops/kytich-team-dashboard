#!/usr/bin/env node
// Script cho lịch tự động (bot 8h sáng) đọc/ghi dashboard.
// Đăng nhập bằng tài khoản role 'bot'. Mật khẩu lấy từ macOS Keychain, KHÔNG nằm trong file/repo/log.
//
//   node scripts/bot.mjs check                  # thử đăng nhập, in tên + role
//   node scripts/bot.mjs yesterday [YYYY-MM-DD] # in JSON dữ liệu hôm qua của từng người + TB 7 ngày + chủ đề 3 ngày gần
//   node scripts/bot.mjs report --text "..." [--member "Thành viên 1"] [--date YYYY-MM-DD]
//   node scripts/bot.mjs report --file report.json   # [{ "member": null|"Tên", "text": "..." }, ...]
//   node scripts/bot.mjs ideas --file ideas.json     # [{ "topic","question","answer","source":"zalo|web","asked_at","times" }, ...] hỏi + đáp nguyên văn; thêm --replace để thay thẻ chưa ai nhận
//   node scripts/bot.mjs to-review [YYYY-MM-DD] [--kind post|comment] [--all] [--days 3]  # bài/comment chưa chấm: hôm qua + bù 3 ngày trước (mỗi bài có "date" riêng)
//   node scripts/bot.mjs reviews --file reviews.json     # ghi kết quả chấm + nhận xét tổng (xem scripts/examples/)
//   node scripts/bot.mjs targets --file targets.json     # ghi "Cơ hội seeding" (bài người khác đáng vào comment)
//   node scripts/bot.mjs kho-build                    # gom hỏi đáp Zalo nguyên văn vào kho trên máy (JSON + CSV)
//   node scripts/bot.mjs kho-fill [--min 60]          # nạp hết kho hỏi đáp lên dashboard (kho ý tưởng chung, web hiện 30 câu)
//   node scripts/bot.mjs affiliate --file aff.json     # đơn affiliate đã trả tiền (SELECT bên web Kỳ Tích): [{id,voucher_code,plan_key,amount_vnd,paid_at}]
//   node scripts/bot.mjs review-moi [--hours 48|--since ISO]     # review đề Muse đẩy lên (bảng group_reviews), JSON
//   node scripts/bot.mjs lang-nghe-moi [--hours 24|--since ISO]  # lắng nghe Muse đẩy lên (bảng group_listening, chỉ bot + Thiện đọc), JSON
//   node scripts/bot.mjs market --file market.json      # báo cáo đối thủ cho cả team (xem scripts/examples/market.example.json)
//   node scripts/bot.mjs target-url --file urls.json    # thay link tạm group#… bằng link bài thật: [{ "from", "to" }]
//   node scripts/bot.mjs target-text --file texts.json  # sửa nội dung bài đã có: [{ "url", "question" }]
//   node scripts/bot.mjs groups                          # danh sách group Facebook đang dùng (JSON)
//   node scripts/bot.mjs run-start morning|evening|scan  # in DONE / BUSY / GO (GO = giữ khóa, bắt đầu làm)
//   node scripts/bot.mjs run-done  morning|evening|scan  # đánh dấu đã xong (scan: xong khung giờ hiện tại), nhả khóa
//   node scripts/bot.mjs run-fail  morning|evening|scan  # nhả khóa để lần thử sau (10 phút) chạy lại
//   node scripts/bot.mjs bv-get [tasks|ideas|focus|reports|days|meta] [--id ID]  # Bàn việc của Thiện: in JSON [{col,id,data}]
//   node scripts/bot.mjs bv-put --file x.json [--merge]  # ghi Bàn việc: [{col,id,data}] (hoặc file xuất {tasks:[{id,data}],...}); --merge = chỉ đè các trường gửi lên
//   node scripts/bot.mjs bv-del --col tasks --id ID [--id ID2]  # xoá hẳn bản ghi Bàn việc (luật dọn việc xong quá 14 ngày)
//   node scripts/bot.mjs chia-lai [--apply] [--deu]  # chia lại bài cần trả lời chưa ai nhận theo tỉ lệ ở tab Cài đặt (ô cmt/ngày); không --apply = chỉ xem
//   node scripts/bot.mjs tien-do [--chot]  # in tin tiến độ seeding hôm nay của từng người (cho Telegram 10h/16h/21h); --chot thêm dòng chốt ngày
//   Bàn việc chỉ Thiện và bot đọc/ghi được (RLS). Dữ liệu có số tài chính: không in ra log chung, không đưa lên git.
//   scan = quét group giữa ngày, mỗi khung 1 lần: 8h (08–10:59), 11h, 14h, 20h (20–23:59); 17h là lượt evening.
//   Mọi lượt dùng chung Facebook nên không chạy chồng nhau. scan in "GO since=<ISO>" = lần đọc group gần nhất.
//
// Cấu hình: đọc VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LOGIN_DOMAIN từ .env.local (hoặc biến môi trường).
// BOT_EMAIL mặc định bot@<domain>. Keychain service: kytich-dashboard-bot (account = BOT_EMAIL).
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildKho, pickFromKho, normQ, KHO_FILE } from './kho.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEYCHAIN_SERVICE = 'kytich-dashboard-bot'

function loadEnv() {
  const env = { ...process.env }
  for (const f of ['.env', '.env.local']) {
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

function die(msg) { console.error('LỖI: ' + msg); process.exit(1) }

const env = loadEnv()
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const DOMAIN = env.VITE_LOGIN_DOMAIN || 'aptiskytich.vn'
const BOT_EMAIL = (env.BOT_EMAIL || `bot@${DOMAIN}`).toLowerCase()

function keychainPassword() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', BOT_EMAIL, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    die(`Không thấy mật khẩu bot trong Keychain (service "${KEYCHAIN_SERVICE}", account "${BOT_EMAIL}"). Xem README mục "Lưu mật khẩu bot".`)
  }
}

const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

function args(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2), v = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
      o[k] = k in o ? [].concat(o[k], v) : v // lặp lại khoá (vd nhiều --id) thì gom thành mảng
    }
    else o._.push(argv[i])
  }
  return o
}

async function main() {
  const a = args(process.argv.slice(2))
  const cmd = a._[0]
  // ---- Trạng thái chạy của lịch tự động (lưu trên máy, không cần đăng nhập) ----
  if (cmd?.startsWith('run-')) {
    const job = a._[1]
    if (!['morning', 'evening', 'scan'].includes(job)) die('Cần morning, evening hoặc scan')
    const dir = join(homedir(), 'Library', 'Application Support', 'kytich-bot')
    mkdirSync(dir, { recursive: true })
    const today = vnToday()
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
    // Khung quét giữa ngày: 8h, 11h, 14h, 20h (17h do lượt evening làm đầy đủ)
    const slot = job !== 'scan' ? '' : hour >= 20 ? '20' : hour >= 17 ? null : hour >= 14 ? '14' : hour >= 11 ? '11' : hour >= 8 ? '08' : null
    const done = join(dir, job === 'scan' ? `scan-${today}-${slot}.done` : `${job}-${today}.done`)
    const lock = join(dir, `${job}.lock`)
    const lastScan = join(dir, 'last-scan.txt') // lần đọc group gần nhất (scan hoặc evening)
    const LOCK_MAX_MIN = 60 // lần chạy treo quá 60 phút thì coi như đã chết, cho chạy lại
    const fresh = (f) => existsSync(f) && (Date.now() - statSync(f).mtimeMs) / 60000 < LOCK_MAX_MIN
    if (cmd === 'run-start') {
      if (job === 'scan' && slot === null) return console.log('DONE')
      if (existsSync(done)) return console.log('DONE')
      if (fresh(lock)) return console.log('BUSY')
      // Các lượt đều dùng Facebook trên cùng Chrome: lượt khác đang chạy thì chờ
      if (['morning', 'evening', 'scan'].some((j) => j !== job && fresh(join(dir, `${j}.lock`)))) return console.log('BUSY')
      if (job === 'scan' && slot === '20') {
        // Khung 20h: lượt 17h chưa xong thì để nó làm trước; vừa xong sau 19h thì khỏi quét lại
        const ev = join(dir, `evening-${today}.done`)
        if (!existsSync(ev)) return console.log('BUSY')
        const evHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(statSync(ev).mtime))
        if (evHour >= 19) { writeFileSync(done, 'skip: evening vừa chạy'); return console.log('DONE') }
      }
      writeFileSync(lock, new Date().toISOString() + (slot ? ' ' + slot : ''))
      if (job === 'scan') return console.log('GO since=' + (existsSync(lastScan) ? readFileSync(lastScan, 'utf8').trim() : new Date(Date.now() - 24 * 3600e3).toISOString()))
      return console.log('GO')
    }
    if (cmd === 'run-done') {
      // Khoá ghi "<ISO lúc bắt đầu> <khung>": lượt bắt đầu 10:55 xong 11:05 phải đánh dấu khung 08h,
      // không được đánh dấu nhầm khung 11h (làm mất lượt 11h)
      const [startedAt, startSlot] = (existsSync(lock) ? readFileSync(lock, 'utf8').trim() : '').split(' ')
      const s = job === 'scan' ? startSlot || slot : slot
      if (job === 'scan' && !s) die('Ngoài khung quét')
      if (job !== 'morning') writeFileSync(lastScan, startedAt || new Date().toISOString())
      writeFileSync(job === 'scan' ? join(dir, `scan-${today}-${s}.done`) : done, new Date().toISOString()); rmSync(lock, { force: true })
      return console.log('OK: đã đánh dấu xong ' + job + (s ? ' khung ' + s + 'h' : ''))
    }
    if (cmd === 'run-fail') { rmSync(lock, { force: true }); return console.log('OK: đã nhả khóa ' + job) }
    die('Lệnh không hợp lệ: ' + cmd)
  }
  // ---- Kho hỏi đáp Zalo (trên máy, không cần đăng nhập) ----
  if (cmd === 'kho-build') {
    const kho = buildKho()
    const by = {}; kho.forEach((k) => { by[k.topic] = (by[k.topic] || 0) + 1 })
    return console.log(`OK: kho có ${kho.length} câu hỏi + trả lời (${Object.entries(by).map(([t, n]) => t + ' ' + n).join(', ')}) → ${KHO_FILE}`)
  }
  if (!cmd || cmd === 'help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 35).join('\n')); return }

  if (!URL || !KEY) die('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env.local')
  const sb = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error: authErr } = await sb.auth.signInWithPassword({ email: BOT_EMAIL, password: keychainPassword() })
  if (authErr) die('Đăng nhập bot thất bại: ' + authErr.message)

  const q = async (p) => { const { data, error } = await p; if (error) die(error.message); return data }
  const members = await q(sb.from('members').select('*').order('sort_order'))
  const SEED_GROUPS = ['Key Aptis miễn phí - update liên tục', 'Hội review đề Aptis có tâm'], SEED_FROM = '2026-11-05'
  // Người nhận bài cần trả lời: nhân viên đang làm, có tỉ lệ > 0, không tính tài khoản mẫu "Thành viên N".
  // load = số bài đang mở của từng người: bài mới đang giao cho họ + bài họ đã nhận nhưng chưa xong
  const openLoad = async () => {
    const staff = members.filter((m) => m.active && m.role === 'staff' && (m.comment_quota ?? 0) > 0 && !/^Thành viên \d/.test(m.name))
    const load = Object.fromEntries(staff.map((m) => [m.id, 0]))
    // Chỉ tính bài hiện ở mục "Bài cần trả lời" trên dashboard: 2 group seeding, từ 05/11 (giống Today.jsx)
    const open = (await q(sb.from('seed_targets').select('id,date,group_name,status,assigned_to,taken_by').in('status', ['new', 'taken'])))
      .filter((t) => SEED_GROUPS.includes(t.group_name) && t.date >= SEED_FROM)
    for (const t of open) {
      const who = t.status === 'taken' ? t.taken_by : t.assigned_to
      if (who in load) load[who]++
    }
    return { staff, load, open }
  }
  const me = members.find((m) => m.login_email === BOT_EMAIL)
  if (!me || me.role !== 'bot' || !me.active) die(`${BOT_EMAIL} chưa có trong bảng members với role 'bot'.`)
  const byName = (name) => {
    if (!name) return null
    const m = members.find((x) => x.name.toLowerCase() === String(name).toLowerCase() || x.id === name)
    if (!m) die(`Không tìm thấy thành viên "${name}"`)
    return m.id
  }

  if (cmd === 'check') {
    console.log(`OK: đăng nhập ${me.name} (${me.role}). Thấy ${members.length} thành viên.`)
  } else if (cmd === 'yesterday') {
    const day = a._[1] || addDays(vnToday(), -1)
    const from7 = addDays(day, -6)
    const range = (t, f) => q(sb.from(t).select('*').gte('date', f).lte('date', day))
    const [routines, checks, extras, posts, notes, ideas] = await Promise.all([
      q(sb.from('routines').select('*').eq('active', true)),
      range('daily_checks', day), range('extra_tasks', day), range('seeding_posts', from7), range('day_notes', day),
      q(sb.from('seed_ideas').select('date,topic').gte('date', addDays(day, -2)).lte('date', addDays(day, 1))),
    ])
    const staff = members.filter((m) => m.active && m.role === 'staff')
    const people = staff.map((m) => {
      const rs = routines.filter((r) => r.member_id === m.id)
      const done = rs.filter((r) => checks.some((c) => c.routine_id === r.id && c.member_id === m.id && c.date === day && c.done))
      const ex = extras.filter((e) => e.member_id === m.id && e.date === day)
      const p = posts.filter((x) => x.member_id === m.id)
      const today = p.filter((x) => x.date === day)
      return {
        name: m.name,
        routines: { done: done.length + ex.filter((e) => e.done).length, total: rs.length + ex.length, missing: rs.filter((r) => !done.includes(r)).map((r) => r.title) },
        posts: { count: today.filter((x) => x.kind === 'post').length, quota: m.seeding_quota },
        comments: { count: today.filter((x) => x.kind === 'comment').length, quota: m.comment_quota ?? 0 },
        links: today.map((x) => ({ url: x.url, group: x.group_name, kind: x.kind, question: x.question || null })),
        seeding_avg_7d: Math.round((p.length / 7) * 10) / 10,
        day_note: notes.find((n) => n.member_id === m.id && n.date === day)?.note || null,
      }
    })
    console.log(JSON.stringify({ date: day, people, recent_topics: [...new Set(ideas.map((i) => i.topic))] }, null, 2))
  } else if (cmd === 'report') {
    const date = a.date || vnToday()
    const items = a.file ? JSON.parse(readFileSync(a.file, 'utf8')) : [{ member: a.member || null, text: a.text }]
    const rows = items.map((it) => {
      if (!it.text || typeof it.text !== 'string') die('Thiếu nội dung "text"')
      return { date: it.date || date, member_id: byName(it.member), text: it.text }
    })
    // Một ngày một báo cáo cho mỗi người (member null = báo cáo chung): ghi đè nếu chạy lại
    for (const r of rows) {
      let s = sb.from('team_reports').delete().eq('date', r.date)
      s = r.member_id ? s.eq('member_id', r.member_id) : s.is('member_id', null)
      await q(s)
    }
    await q(sb.from('team_reports').insert(rows))
    console.log(`OK: đã ghi ${rows.length} báo cáo cho ngày ${date}.`)
  } else if (cmd === 'ideas') {
    if (!a.file) die('Cần --file ideas.json')
    const date = a.date || vnToday()
    const items = JSON.parse(readFileSync(a.file, 'utf8'))
    const rows = items.map((it) => {
      if (!it.topic) die('Mỗi thẻ cần "topic"')
      // Thẻ dạng mới: câu học viên hỏi nguyên văn + nguồn/giờ/số lần (lưu ở cột angle dạng "meta:{json}", không cần đổi bảng)
      if (it.source !== undefined) {
        if (!['web', 'zalo'].includes(it.source)) die('"source" phải là web hoặc zalo')
        if (!it.question) die('Thẻ câu hỏi cần "question" (nguyên văn, đã che thông tin cá nhân)')
        const meta = { src: it.source, at: it.asked_at || null, n: Number(it.times) || 1, ans: it.answer || null }
        return { date: it.date || date, topic: it.topic, question: it.question, angle: 'meta:' + JSON.stringify(meta), gift_doc: null, assigned_to: byName(it.assigned_to) }
      }
      return { date: it.date || date, topic: it.topic, question: it.question || null, angle: it.angle || null, gift_doc: it.gift_doc || null, assigned_to: byName(it.assigned_to) }
    })
    // --replace: bỏ các thẻ của ngày đó CHƯA AI NHẬN rồi ghi bộ mới (thẻ đã có người nhận giữ nguyên)
    let removed = 0
    if (a.replace) removed = (await q(sb.from('seed_ideas').delete().eq('date', date).is('taken_by', null).select('id'))).length
    await q(sb.from('seed_ideas').insert(rows))
    console.log(`OK: đã thêm ${rows.length} thẻ gợi ý cho ngày ${date}${a.replace ? ` (thay ${removed} thẻ cũ chưa ai nhận)` : ''}.`)
  } else if (cmd === 'to-review') {
    // Không ghi ngày: lấy hôm qua + bài/comment CHƯA CHẤM của 3 ngày trước đó (bù khi lượt sáng bỏ bước chấm,
    // như 07/11 và 10/11 mất trắng 24 + 62 bài). Ghi ngày cụ thể thì chỉ ngày đó như cũ.
    const day = a._[1] || addDays(vnToday(), -1)
    const from = a._[1] ? day : addDays(day, -(Number(a.days ?? 3)))
    let pq = sb.from('seeding_posts').select('*').gte('date', from).lte('date', day)
    if (a.kind) {
      if (!['post', 'comment'].includes(a.kind)) die('--kind phải là post hoặc comment')
      pq = pq.eq('kind', a.kind)
    }
    const posts = await q(pq.order('created_at'))
    const ids = posts.map((p) => p.id)
    const done = ids.length ? await q(sb.from('seeding_reviews').select('post_id').in('post_id', ids)) : []
    const doneSet = new Set(done.map((r) => r.post_id))
    const ideaIds = [...new Set(posts.map((p) => p.idea_id).filter(Boolean))]
    const ideas = ideaIds.length ? await q(sb.from('seed_ideas').select('id,topic').in('id', ideaIds)) : []
    const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name]))
    // Bài trả lời: kèm câu nhân viên đã comment để bot tìm đúng comment trên bài gốc
    const tIds = [...new Set(posts.map((p) => p.target_id).filter(Boolean))]
    const said = tIds.length ? Object.fromEntries((await q(sb.from('seed_targets').select('id,comment_text').in('id', tIds))).map((t) => [t.id, t.comment_text])) : {}
    const out = posts.filter((p) => a.all || !doneSet.has(p.id)).map((p) => ({
      post_id: p.id, member: nameOf[p.member_id], date: p.date, posted_at: p.created_at, url: p.url,
      group: p.group_name, kind: p.kind, question: p.question || null, idea_topic: ideas.find((i) => i.id === p.idea_id)?.topic || null,
      already_reviewed: doneSet.has(p.id), comment_text: p.target_id ? said[p.target_id] || null : null,
    }))
    console.log(JSON.stringify({ date: day, from, total_posts: posts.length, to_review: out.length, posts: out }, null, 2))
  } else if (cmd === 'reviews') {
    if (!a.file) die('Cần --file reviews.json')
    const input = JSON.parse(readFileSync(a.file, 'utf8'))
    const date = input.date || addDays(vnToday(), -1)
    const STATUS = ['live', 'hidden', 'removed', 'pending', 'unreachable']
    const FLAGS = ['dong_vai_hoc_vien', 'chep_tin_khach', 'spam_link', 'sai_group', 'van_mau']
    const int = (v, k) => {
      if (v === null || v === undefined || v === '') return null
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) die(`"${k}" phải là số nguyên ≥ 0 hoặc null`)
      return n
    }
    const reviews = (input.reviews || []).map((r) => {
      if (!r.post_id) die('Mỗi review cần "post_id" (lấy từ lệnh to-review)')
      if (!STATUS.includes(r.status)) die(`status phải là: ${STATUS.join(', ')}`)
      const flags = r.rule_flags || []
      const bad = flags.filter((f) => !FLAGS.includes(f))
      if (bad.length) die(`rule_flags không hợp lệ: ${bad.join(', ')} (chỉ: ${FLAGS.join(', ')})`)
      const score = r.score == null ? null : Number(r.score)
      if (score != null && !(Number.isInteger(score) && score >= 1 && score <= 5)) die('score phải 1–5')
      return {
        post_id: r.post_id, checked_at: new Date().toISOString(), status: r.status,
        reactions: int(r.reactions, 'reactions'), comments: int(r.comments, 'comments'), shares: int(r.shares, 'shares'),
        asker_replied: typeof r.asker_replied === 'boolean' ? r.asker_replied : null,
        score, good: r.good || null, improve: r.improve || null, suggestion: r.suggestion || null, rule_flags: flags,
      }
    })
    const feedback = (input.feedback || []).map((f) => {
      if (!f.text) die('Mỗi feedback cần "text"')
      return { date: f.date || date, member_id: byName(f.member), text: f.text }
    })
    if (reviews.length) await q(sb.from('seeding_reviews').upsert(reviews, { onConflict: 'post_id' }))
    if (feedback.length) await q(sb.from('member_feedback').upsert(feedback, { onConflict: 'date,member_id' }))
    console.log(`OK: đã ghi ${reviews.length} review, ${feedback.length} nhận xét tổng (ngày ${date}).`)
  } else if (cmd === 'groups') {
    const groups = await q(sb.from('seed_groups').select('name,url').eq('active', true).order('sort_order'))
    console.log(JSON.stringify(groups, null, 2))
  } else if (cmd === 'targets') {
    if (!a.file) die('Cần --file targets.json')
    const items = JSON.parse(readFileSync(a.file, 'utf8'))
    const groups = await q(sb.from('seed_groups').select('id,name'))
    // Chia bài theo tỉ lệ cài ở tab Cài đặt (ô "cmt/ngày" = comment_quota): An 10 · Châu 10 → 50/50 (Thiện chốt 08/11).
    // Cân theo số bài ĐANG MỞ của từng người (chưa ai bấm Đã seeding/Bỏ qua), không chỉ bài hôm nay,
    // nên ai đang ôm ít thì được giao trước. Áp cho mọi group (Key Aptis miễn phí, Hội review đề...).
    const { staff, load } = await openLoad()
    const nextStaff = () => {
      if (!staff.length) return null
      const m = staff.reduce((b, x) => (load[x.id] / x.comment_quota < load[b.id] / b.comment_quota ? x : b))
      load[m.id]++
      return m.id
    }
    const rows = items.map((t) => {
      if (!/^https?:\/\//i.test(t.url || '')) die('Mỗi cơ hội cần "url" bắt đầu bằng https://')
      if (!t.question) die('Mỗi cơ hội cần "question" (nội dung bài nguyên văn, đã che thông tin cá nhân)')
      const g = groups.find((x) => x.name.toLowerCase() === String(t.group || '').toLowerCase())
      return { date: t.date || vnToday(), url: t.url, group_id: g?.id ?? null, group_name: g?.name ?? t.group ?? null, question: t.question, angle: t.angle || null, assigned_to: t.assigned_to ? byName(t.assigned_to) : nextStaff() }
    })
    // Bài đã có (trùng url) thì giữ nguyên, không reset trạng thái người đã nhận
    const added = await q(sb.from('seed_targets').upsert(rows, { onConflict: 'url', ignoreDuplicates: true }).select('id'))
    console.log(`OK: thêm ${added.length} cơ hội mới (${rows.length - added.length} bài đã có, bỏ qua).`)
  } else if (cmd === 'kho-fill') {
    // Kho ý tưởng chung (Thiện chốt 06/11): nạp HẾT câu trong kho hỏi đáp chưa có trên dashboard; web luôn hiện 30 câu
    // chưa ai lấy và chưa bị bỏ qua. Còn ít hơn --min (mặc định 60) câu trống thì nạp lại câu cũ dùng lâu nhất.
    const MIN = Number(a.min) || 60
    const today = vnToday()
    if (!existsSync(KHO_FILE)) die('Chưa có kho, chạy kho-build trước')
    const kho = JSON.parse(readFileSync(KHO_FILE, 'utf8'))
    const all = await q(sb.from('seed_ideas').select('question,date,taken_by,skipped_at'))
    const usedOn = new Map()
    all.forEach((p) => { const k = normQ(p.question || ''); if (!usedOn.has(k) || usedOn.get(k) < p.date) usedOn.set(k, p.date) })
    const freeNow = all.filter((p) => !p.taken_by && !p.skipped_at).length
    const fresh = pickFromKho(kho, kho.length, usedOn).filter((k) => !usedOn.has(normQ(k.q)))
    let picks = fresh
    if (freeNow + fresh.length < MIN) picks = picks.concat(pickFromKho(kho, MIN - freeNow - fresh.length, usedOn).filter((k) => usedOn.has(normQ(k.q))))
    if (!picks.length) return console.log(`OK: kho đã nạp hết, đang có ${freeNow} câu trống.`)
    const ddmmhh = (at) => `${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)}`
    const rows = picks.map((k) => ({ date: today, topic: k.topic, question: k.q, angle: 'meta:' + JSON.stringify({ src: 'zalo', at: ddmmhh(k.at), n: k.times, ans: k.a }), gift_doc: null, assigned_to: null }))
    for (let i = 0; i < rows.length; i += 200) await q(sb.from('seed_ideas').insert(rows.slice(i, i + 200)))
    console.log(`OK: nạp ${rows.length} câu (${fresh.length} câu mới), kho trên dashboard giờ có ${freeNow + rows.length} câu trống.`)
  } else if (cmd === 'chia-lai') {
    // Chia lại bài cần trả lời CHƯA AI NHẬN (status new) cho đều theo tỉ lệ ở tab Cài đặt. Bài đã nhận/đã seeding/bỏ qua giữ nguyên.
    // Mặc định chỉ in kế hoạch; thêm --apply mới ghi (đổi dữ liệu: cần Thiện duyệt).
    // --deu: chia đều mọi người, bỏ qua tỉ lệ ở Cài đặt (dùng khi Thiện bảo chia đều ngay mà ô cmt/ngày chưa sửa)
    const { staff: st0, open } = await openLoad()
    const staff = a.deu ? st0.map((m) => ({ ...m, comment_quota: 1 })) : st0
    if (!staff.length) die('Không có nhân viên nào có tỉ lệ > 0')
    const name = (id) => members.find((m) => m.id === id)?.name || (id ? 'người khác' : 'chưa giao')
    const count = (rows, key) => { const c = {}; for (const t of rows) c[name(t[key])] = (c[name(t[key])] || 0) + 1; return Object.entries(c).map(([k, v]) => k + ' ' + v).join(', ') || '0' }
    const plan = [], after = Object.fromEntries(staff.map((m) => [m.id, 0]))
    console.log('Tỉ lệ (ô cmt/ngày ở Cài đặt): ' + staff.map((m) => `${m.name} ${m.comment_quota}`).join(' · '))
    // Chia riêng từng group để cả Key Aptis miễn phí lẫn Hội review đề đều đúng tỉ lệ
    for (const g of SEED_GROUPS) {
      const rows = open.filter((t) => t.group_name === g)
      const load = Object.fromEntries(staff.map((m) => [m.id, 0]))
      for (const t of rows) if (t.status === 'taken' && t.taken_by in load) load[t.taken_by]++
      const free = rows.filter((t) => t.status === 'new').sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1))
      const before = count(free, 'assigned_to')
      for (const t of free) {
        const m = staff.reduce((b, x) => (load[x.id] / x.comment_quota < load[b.id] / b.comment_quota ? x : b))
        load[m.id]++
        if (t.assigned_to !== m.id) plan.push({ id: t.id, to: m.id })
      }
      for (const m of staff) after[m.id] += load[m.id]
      console.log(`${g}: ${rows.length} bài mở, ${rows.length - free.length} đã có người nhận. Chưa nhận trước: ${before} → sau: ${staff.map((m) => m.name + ' ' + load[m.id]).join(', ')}`)
    }
    console.log('Tổng sau khi chia: ' + staff.map((m) => `${m.name} ${after[m.id]}`).join(' · '))
    console.log(`Cần đổi người: ${plan.length} bài`)
    if (!a.apply) { console.log('Chưa ghi. Thêm --apply để ghi.'); process.exit(0) }
    for (const m of staff) {
      const ids = plan.filter((p) => p.to === m.id).map((p) => p.id)
      for (let i = 0; i < ids.length; i += 200) await q(sb.from('seed_targets').update({ assigned_to: m.id }).in('id', ids.slice(i, i + 200)).eq('status', 'new').select('id'))
    }
    console.log(`OK: đã chia lại ${plan.length} bài.`)
  } else if (cmd === 'tien-do') {
    // Số liệu giống trang Cả đội: bài seeding hôm nay / seeding_quota; bài cần trả lời = bài ở 2 group seeding,
    // từ 05/11, còn mở và đang giao cho người đó (bài trả lời không có chỉ tiêu, phải trả lời hết)
    const today = vnToday()
    const GROUPS = SEED_GROUPS, FROM = SEED_FROM
    const staff = members.filter((m) => m.role === 'staff' && m.active && !/^Thành viên \d/.test(m.name))
    const posts = await q(sb.from('seeding_posts').select('member_id,kind').eq('date', today))
    const open = (await q(sb.from('seed_targets').select('group_name,date,status,assigned_to,taken_by').in('status', ['new', 'taken'])))
      .filter((t) => GROUPS.includes(t.group_name) && t.date >= FROM)
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(new Date())
    const [, mm, dd] = today.split('-')
    const lines = [`📊 Seeding ${Number(hour)}h · ${dd}/${mm}`], warn = [], du = [], thieu = []
    let conDang = 0, conTL = 0
    for (const m of staff) {
      const mine = posts.filter((p) => p.member_id === m.id)
      const dang = mine.filter((p) => p.kind === 'post').length, tl = mine.filter((p) => p.kind === 'comment').length
      const qd = m.seeding_quota || 0, cd = Math.max(0, qd - dang)
      const ct = open.filter((t) => (t.status === 'new' && t.assigned_to === m.id) || (t.status === 'taken' && t.taken_by === m.id)).length
      conDang += cd; conTL += ct
      const ok = cd === 0 && ct === 0
      lines.push(`${ok ? '✅ ' : ''}${m.name}: đăng ${dang}/${qd}${cd ? ` (còn ${cd})` : ''} · đã trả lời ${tl}${ct ? `, còn ${ct} bài chưa trả lời` : ', hết bài cần trả lời'}`)
      if (!dang && !tl) warn.push(`⚠️ ${m.name} chưa làm bài nào hôm nay`)
      ;(ok ? du : thieu).push(ok ? m.name : `${m.name} còn ${[cd && cd + ' bài đăng', ct && ct + ' bài trả lời'].filter(Boolean).join(', ')}`)
    }
    const chuaGiao = open.filter((t) => t.status === 'new' && !t.assigned_to).length
    lines.push(`Cả đội: còn ${conDang} bài đăng · ${conTL} bài trả lời${chuaGiao ? ` · ${chuaGiao} bài chưa giao ai` : ''}`)
    lines.push(...warn)
    if (a.chot) lines.push(`Chốt ngày: ${du.length ? 'đủ chỉ tiêu: ' + du.join(', ') : 'chưa ai đủ chỉ tiêu'}${thieu.length ? '. Thiếu: ' + thieu.join('; ') : ''}`)
    console.log(lines.slice(0, 8).join('\n'))
  } else if (cmd === 'bv-get') {
    const COLS = ['tasks', 'ideas', 'focus', 'reports', 'days', 'meta']
    const col = a._[1]
    if (col && !COLS.includes(col)) die('col phải là một trong: ' + COLS.join(', '))
    let rows = [], from = 0
    for (;;) { // lấy hết, mỗi lần 1000 dòng
      let p = sb.from('owner_docs').select('col,id,data').order('col').order('id').range(from, from + 999)
      if (col) p = p.eq('col', col)
      if (a.id) p = p.in('id', [].concat(a.id))
      const d = await q(p); rows = rows.concat(d); if (d.length < 1000) break; from += 1000
    }
    console.log(JSON.stringify(rows, null, 1))
  } else if (cmd === 'bv-put') {
    if (!a.file) die('Cần --file x.json')
    const raw = JSON.parse(readFileSync(a.file, 'utf8'))
    // Nhận cả file xuất từ trang cũ: { tasks: [{id,data}], ideas: [...], meta: [...], ... }
    const rows = Array.isArray(raw) ? raw : Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && Array.isArray(v)).flatMap(([col, v]) => v.map((x) => ({ col, id: x.id, data: x.data })))
    for (const r of rows) if (!r.col || !r.id || typeof r.data !== 'object' || r.data === null) die('Mỗi dòng cần col, id, data (object)')
    let n = 0
    for (let i = 0; i < rows.length; i += 200) {
      let chunk = rows.slice(i, i + 200)
      if (a.merge) {
        const old = await q(sb.from('owner_docs').select('col,id,data').in('id', chunk.map((r) => r.id)))
        chunk = chunk.map((r) => { const o = old.find((x) => x.col === r.col && x.id === r.id); return { ...r, data: { ...(o?.data || {}), ...r.data } } })
      }
      await q(sb.from('owner_docs').upsert(chunk.map((r) => ({ col: r.col, id: String(r.id), data: r.data, updated_at: new Date().toISOString() })), { onConflict: 'col,id' }))
      n += chunk.length
    }
    const by = {}; rows.forEach((r) => { by[r.col] = (by[r.col] || 0) + 1 })
    console.log(`OK: đã ghi ${n} bản ghi Bàn việc (${Object.entries(by).map(([k, v]) => k + ' ' + v).join(', ')}).`)
  } else if (cmd === 'bv-del') {
    if (!a.col || !a.id) die('Cần --col và ít nhất một --id')
    const ids = [].concat(a.id)
    const d = await q(sb.from('owner_docs').delete().eq('col', a.col).in('id', ids).select('id'))
    console.log(`OK: đã xoá ${d.length}/${ids.length} bản ghi ${a.col}.`)
  } else if (cmd === 'affiliate') {
    // Đơn affiliate: file là kết quả SELECT bên web Kỳ Tích (chỉ đọc), mỗi phần tử
    // { id, voucher_code, plan_key, amount_vnd, paid_at } của payments status='paid'. KHÔNG kèm email/tên/user_id.
    // Hoa hồng cố định 10% số tiền thực trả (Thiện chốt 12/11). Đơn đã có (trùng id) thì ghi đè số liệu.
    if (!a.file) die('Cần --file affiliate.json')
    const items = JSON.parse(readFileSync(a.file, 'utf8'))
    if (!Array.isArray(items)) die('File phải là mảng đơn')
    const codes = await q(sb.from('affiliate_codes').select('code,member_id').eq('active', true))
    const byCode = Object.fromEntries(codes.map((c) => [c.code.toUpperCase(), c.member_id]))
    const vnMonth = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7)
    const skip = []
    const rows = items.flatMap((o) => {
      const code = String(o.voucher_code || '').trim().toUpperCase()
      if (!o.id || !o.paid_at || !(code in byCode)) { skip.push(code || '(trống)'); return [] }
      const amount = Math.max(0, Math.round(Number(o.amount_vnd) || 0))
      return [{ payment_id: o.id, code, member_id: byCode[code], paid_at: o.paid_at, month: vnMonth(o.paid_at), plan_key: o.plan_key || null,
        amount_vnd: amount, commission_vnd: Math.round(amount * 0.1), synced_at: new Date().toISOString() }]
    })
    if (rows.length) await q(sb.from('affiliate_orders').upsert(rows, { onConflict: 'payment_id' }))
    const m = vnToday().slice(0, 7)
    const all = await q(sb.from('affiliate_orders').select('member_id,amount_vnd,commission_vnd').eq('month', m))
    const nm = Object.fromEntries(members.map((x) => [x.id, x.name]))
    const sum = {}; for (const o of all) { const k = nm[o.member_id]; sum[k] = sum[k] || [0, 0, 0]; sum[k][0]++; sum[k][1] += o.amount_vnd; sum[k][2] += o.commission_vnd }
    console.log(`OK: ghi ${rows.length} đơn${skip.length ? `, bỏ ${skip.length} (mã không có trong danh sách: ${[...new Set(skip)].join(', ')})` : ''}.`)
    console.log(`Tháng ${m}: ` + (Object.entries(sum).map(([k, v]) => `${k} ${v[0]} đơn, ${v[1].toLocaleString('vi-VN')}đ, hoa hồng ${v[2].toLocaleString('vi-VN')}đ`).join(' · ') || 'chưa có đơn'))
  } else if (cmd === 'review-moi' || cmd === 'lang-nghe-moi') {
    // Đọc dữ liệu Muse đẩy lên (SQL 010): review đề / lắng nghe mới hơn mốc. Mặc định review 48 giờ, lắng nghe 24 giờ.
    // --since <ISO> để lấy sau đúng mốc (vd lần gom key trước). In JSON cho lịch trên máy đọc.
    const isReview = cmd === 'review-moi'
    const since = a.since || new Date(Date.now() - (Number(a.hours) || (isReview ? 48 : 24)) * 3600e3).toISOString()
    const table = isReview ? 'group_reviews' : 'group_listening'
    const rows = await q(sb.from(table).select('*').gt('created_at', since).order('created_at'))
    console.log(JSON.stringify({ since, count: rows.length, items: rows }, null, 2))
  } else if (cmd === 'market') {
    // Báo cáo đối thủ / thị trường cho cả team (1 bản mỗi ngày, ghi lại thì đè bản cùng ngày)
    if (!a.file) die('Cần --file market.json')
    const r = JSON.parse(readFileSync(a.file, 'utf8'))
    if (!r.summary) die('Cần "summary" (3–5 dòng tóm tắt)')
    if (!Array.isArray(r.competitors)) die('Cần "competitors": [{ name, url, posts, highlights, events, engagement }]')
    const row = { date: r.date || vnToday(), summary: r.summary, competitors: r.competitors, suggestions: r.suggestions || [] }
    await q(sb.from('market_reports').upsert(row, { onConflict: 'date' }))
    console.log(`OK: đã ghi báo cáo đối thủ ngày ${row.date} (${r.competitors.length} đối thủ).`)
  } else if (cmd === 'target-url') {
    // Thay link tạm (group#…) bằng link thật của bài. Trùng với dòng đã có link thật thì gộp: giữ dòng cũ, bỏ qua dòng tạm.
    if (!a.file) die('Cần --file urls.json')
    const items = JSON.parse(readFileSync(a.file, 'utf8'))
    let fixed = 0, merged = 0
    for (const it of items) {
      if (!it.from || !/^https:\/\/www\.facebook\.com\/groups\/.+\/(posts|permalink)\/\d+/.test(it.to || '')) die('Mỗi dòng cần "from" và "to" là link bài thật')
      const [row] = await q(sb.from('seed_targets').select('*').eq('url', it.from))
      if (!row) continue
      const [ex] = await q(sb.from('seed_targets').select('*').eq('url', it.to))
      if (!ex) { await q(sb.from('seed_targets').update({ url: it.to }).eq('id', row.id)); fixed++; continue }
      if (ex.status === 'new' || ex.status === 'taken') await q(sb.from('seed_targets').update({ date: row.date > ex.date ? row.date : ex.date }).eq('id', ex.id))
      await q(sb.from('seed_targets').update({ status: 'skipped' }).eq('id', row.id)); merged++
    }
    console.log(`OK: sửa link ${fixed} bài, gộp ${merged} bài trùng.`)
  } else if (cmd === 'target-text') {
    // Sửa nội dung bài (cột question) của cơ hội đã có theo url; không đụng trạng thái/người nhận
    if (!a.file) die('Cần --file texts.json')
    const items = JSON.parse(readFileSync(a.file, 'utf8'))
    let n = 0
    for (const t of items) {
      if (!t.url || !t.question) die('Mỗi dòng cần "url" và "question"')
      const r = await q(sb.from('seed_targets').update({ question: t.question }).eq('url', t.url).select('id'))
      n += r.length
    }
    console.log(`OK: đã sửa nội dung ${n}/${items.length} bài.`)
  } else {
    die('Lệnh không hợp lệ: ' + cmd + ' (xem: node scripts/bot.mjs help)')
  }
  await sb.auth.signOut()
}

main().catch((e) => die(e.message))
