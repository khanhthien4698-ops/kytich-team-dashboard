#!/usr/bin/env node
// Script cho lịch tự động (bot 8h sáng) đọc/ghi dashboard.
// Đăng nhập bằng tài khoản role 'bot'. Mật khẩu lấy từ macOS Keychain, KHÔNG nằm trong file/repo/log.
//
//   node scripts/bot.mjs check                  # thử đăng nhập, in tên + role
//   node scripts/bot.mjs yesterday [YYYY-MM-DD] # in JSON dữ liệu hôm qua của từng người + TB 7 ngày + chủ đề 3 ngày gần
//   node scripts/bot.mjs report --text "..." [--member "Thành viên 1"] [--date YYYY-MM-DD]
//   node scripts/bot.mjs report --file report.json   # [{ "member": null|"Tên", "text": "..." }, ...]
//   node scripts/bot.mjs ideas --file ideas.json     # [{ "topic","question","answer","source":"zalo|web","asked_at","times" }, ...] hỏi + đáp nguyên văn; thêm --replace để thay thẻ chưa ai nhận
//   node scripts/bot.mjs to-review [YYYY-MM-DD] [--kind post|comment] [--all]  # bài/comment hôm qua chưa chấm
//   node scripts/bot.mjs reviews --file reviews.json     # ghi kết quả chấm + nhận xét tổng (xem scripts/examples/)
//   node scripts/bot.mjs targets --file targets.json     # ghi "Cơ hội seeding" (bài người khác đáng vào comment)
//   node scripts/bot.mjs kho-build                    # gom hỏi đáp Zalo nguyên văn vào kho trên máy (JSON + CSV)
//   node scripts/bot.mjs kho-fill [--n 30]            # bù thẻ Gợi ý bài đăng hôm nay cho đủ N thẻ chưa ai nhận
//   node scripts/bot.mjs target-text --file texts.json  # sửa nội dung bài đã có: [{ "url", "question" }]
//   node scripts/bot.mjs groups                          # danh sách group Facebook đang dùng (JSON)
//   node scripts/bot.mjs run-start morning|evening|scan  # in DONE / BUSY / GO (GO = giữ khóa, bắt đầu làm)
//   node scripts/bot.mjs run-done  morning|evening|scan  # đánh dấu đã xong (scan: xong khung giờ hiện tại), nhả khóa
//   node scripts/bot.mjs run-fail  morning|evening|scan  # nhả khóa để lần thử sau (10 phút) chạy lại
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
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
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
      writeFileSync(lock, new Date().toISOString())
      if (job === 'scan') return console.log('GO since=' + (existsSync(lastScan) ? readFileSync(lastScan, 'utf8').trim() : new Date(Date.now() - 24 * 3600e3).toISOString()))
      return console.log('GO')
    }
    if (cmd === 'run-done') {
      if (job === 'scan' && slot === null) die('Ngoài khung quét')
      if (job !== 'morning') writeFileSync(lastScan, readFileSync(lock, 'utf8').trim() || new Date().toISOString())
      writeFileSync(done, new Date().toISOString()); rmSync(lock, { force: true })
      return console.log('OK: đã đánh dấu xong ' + job + (slot ? ' khung ' + slot + 'h' : ''))
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
  if (!cmd || cmd === 'help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).join('\n')); return }

  if (!URL || !KEY) die('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env.local')
  const sb = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error: authErr } = await sb.auth.signInWithPassword({ email: BOT_EMAIL, password: keychainPassword() })
  if (authErr) die('Đăng nhập bot thất bại: ' + authErr.message)

  const q = async (p) => { const { data, error } = await p; if (error) die(error.message); return data }
  const members = await q(sb.from('members').select('*').order('sort_order'))
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
    const day = a._[1] || addDays(vnToday(), -1)
    let pq = sb.from('seeding_posts').select('*').eq('date', day)
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
    const out = posts.filter((p) => a.all || !doneSet.has(p.id)).map((p) => ({
      post_id: p.id, member: nameOf[p.member_id], date: p.date, posted_at: p.created_at, url: p.url,
      group: p.group_name, kind: p.kind, question: p.question || null, idea_topic: ideas.find((i) => i.id === p.idea_id)?.topic || null,
      already_reviewed: doneSet.has(p.id),
    }))
    console.log(JSON.stringify({ date: day, total_posts: posts.length, to_review: out.length, posts: out }, null, 2))
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
    const rows = items.map((t) => {
      if (!/^https?:\/\//i.test(t.url || '')) die('Mỗi cơ hội cần "url" bắt đầu bằng https://')
      if (!t.question) die('Mỗi cơ hội cần "question" (nội dung bài nguyên văn, đã che thông tin cá nhân)')
      const g = groups.find((x) => x.name.toLowerCase() === String(t.group || '').toLowerCase())
      return { date: t.date || vnToday(), url: t.url, group_id: g?.id ?? null, group_name: g?.name ?? t.group ?? null, question: t.question, angle: t.angle || null, assigned_to: byName(t.assigned_to) }
    })
    // Bài đã có (trùng url) thì giữ nguyên, không reset trạng thái người đã nhận
    const added = await q(sb.from('seed_targets').upsert(rows, { onConflict: 'url', ignoreDuplicates: true }).select('id'))
    console.log(`OK: thêm ${added.length} cơ hội mới (${rows.length - added.length} bài đã có, bỏ qua).`)
  } else if (cmd === 'kho-fill') {
    // Luôn để đủ N thẻ "chưa ai nhận" trong Gợi ý bài đăng hôm nay, bù từ kho hỏi đáp
    const N = Number(a.n) || 30
    const today = vnToday()
    if (!existsSync(KHO_FILE)) die('Chưa có kho, chạy kho-build trước')
    const kho = JSON.parse(readFileSync(KHO_FILE, 'utf8'))
    const free = await q(sb.from('seed_ideas').select('id', { count: 'exact' }).eq('date', today).is('taken_by', null))
    const need = N - free.length
    if (need <= 0) return console.log(`OK: hôm nay đã đủ ${free.length} thẻ chưa ai nhận, không thêm.`)
    const past = await q(sb.from('seed_ideas').select('question,date').gte('date', addDays(today, -365)))
    const usedOn = new Map()
    past.forEach((p) => { const k = normQ(p.question || ''); if (!usedOn.has(k) || usedOn.get(k) < p.date) usedOn.set(k, p.date) })
    const picks = pickFromKho(kho, need, usedOn)
    if (!picks.length) return console.log('Kho trống, không có câu để thêm.')
    const ddmmhh = (at) => `${at.slice(8, 10)}/${at.slice(5, 7)} ${at.slice(11, 16)}`
    const rows = picks.map((k) => ({ date: today, topic: k.topic, question: k.q, angle: 'meta:' + JSON.stringify({ src: 'zalo', at: ddmmhh(k.at), n: k.times, ans: k.a }), gift_doc: null, assigned_to: null }))
    await q(sb.from('seed_ideas').insert(rows))
    console.log(`OK: thêm ${rows.length} thẻ từ kho (${picks.filter((k) => !usedOn.has(normQ(k.q))).length} câu mới chưa dùng), giờ có ${free.length + rows.length} thẻ chưa ai nhận.`)
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
