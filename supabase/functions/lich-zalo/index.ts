// lich-zalo: máy chủ tự gửi tin Zalo theo giờ, không cần máy Thiện, không AI (Thiện duyệt 27/11/2026, SQL 020).
// pg_cron gọi POST {"loai": "seeding"} lúc 9h, 11h30, 17h, 22h (lượt bù sau 20 phút; 9h thêm 28/11, SQL 021) và {"loai": "co_dong"} 8h-8h50 (mỗi 10 phút, gửi 1 lần/ngày).
//   seeding: tiến độ seeding hôm nay, nội dung y lệnh `bot.mjs tien-do` (22h thêm dòng chốt ngày) → nhóm Team.
//   co_dong: báo cáo ngày hôm qua, y mẫu lịch bao-cao-co-dong-ngay-9h → nhóm Cổ đông. Số bất thường → chỉ nhắn riêng Thiện.
// Không cần mã để gọi: mỗi khung giờ chỉ gửi đúng 1 lần (bảng lich_zalo_gui), gọi ngoài giờ thì bỏ qua.
// CHẾ ĐỘ SONG SONG: chưa có secret ZALO_TEAM_ID / ZALO_CODONG_ID thì gửi riêng Thiện (ZALO_CHAT_ID) kèm chữ [Bản máy chủ],
// để so với bản cũ trên máy. Chạy đúng 2-3 ngày rồi Thiện mới thêm 2 secret đó (và tắt bản cũ).
// 28/11: Thiện bảo seeding gửi thẳng nhóm Team (đã có ZALO_TEAM_ID). Cổ đông vẫn song song tới khi có ZALO_CODONG_ID.
// 28/11 chiều: cổ đông cũng gửi thẳng nhóm Cổ đông (ZALO_CODONG_ID), thêm tin tổng kết tháng ngày 1. Chỉ số Kỳ Tích, không EPIX.
// Zalo lỗi: thử lại 3 lần trong lượt, lượt bù 20 phút sau thử tiếp; vẫn lỗi thì nhắn riêng Thiện.
// Secret: ZALO_BOT_TOKEN, ZALO_CHAT_ID, KT_CONG_KEY (dùng chung với muse-cong); ZALO_TEAM_ID, ZALO_CODONG_ID (thêm sau).
// Deploy: Supabase → Edge Functions → Deploy new function → tên "lich-zalo" → dán file này → TẮT "Verify JWT".
import { createClient } from 'npm:@supabase/supabase-js@2'

const V = 'lich-zalo 2026-11-28b'
const URL = Deno.env.get('SUPABASE_URL')!
const sb = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const KT_URL = 'https://bacoamhbatqpxatrrflz.supabase.co'
const KT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhY29hbWhiYXRxcHhhdHJyZmx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTgyODgsImV4cCI6MjA4ODY5NDI4OH0.BcFLY1mFlFxCK7E0E89iLlh4am3mEXkbYZaFJ4O_mpw' // anon key công khai của web Kỳ Tích

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
const vnParts = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), hour: Number(p.hour) }
}
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

async function zalo(chat: string, text: string) {
  const token = Deno.env.get('ZALO_BOT_TOKEN')
  if (!token || !chat) return { ok: false, loi: 'chưa cài bot Zalo' }
  const r = await fetch(`https://bot-api.zaloplatforms.com/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 1990) }),
  })
  const j = await r.json().catch(() => ({}))
  return j?.ok ? { ok: true } : { ok: false, loi: `Zalo ${j?.error_code ?? r.status}` }
}
// Gửi có thử lại: 3 lần, cách 5 rồi 15 giây (rớt mạng, Zalo chập chờn)
async function zaloThuLai(chat: string, text: string) {
  let r: { ok: boolean; loi?: string } = { ok: false, loi: 'chưa gửi' }
  for (const cho of [0, 5000, 15000]) {
    if (cho) await new Promise((x) => setTimeout(x, cho))
    try { r = await zalo(chat, text) } catch (e) { r = { ok: false, loi: e instanceof Error ? e.message : String(e) } }
    if (r.ok) return r
  }
  return r
}
// Người nhận: nhóm thật nếu đã cài secret, chưa thì riêng Thiện (chế độ song song)
function nguoiNhan(secret: string) {
  const g = Deno.env.get(secret)
  return g ? { chat: g, tien_to: '' } : { chat: Deno.env.get('ZALO_CHAT_ID') ?? '', tien_to: '[Bản máy chủ, đang chạy thử] ' }
}
// Giữ chỗ 1 khung giờ: true nếu khung này chưa gửi (hoặc lần trước lỗi)
async function giuCho(loai: string, slot: string) {
  const { data } = await sb.from('lich_zalo_gui').select('trang_thai').eq('loai', loai).eq('slot', slot).maybeSingle()
  if (data && data.trang_thai !== 'loi') return false
  await sb.from('lich_zalo_gui').upsert({ loai, slot, trang_thai: 'dang_gui', luc: new Date().toISOString() }, { onConflict: 'loai,slot' })
  return true
}
const ghi = (loai: string, slot: string, trang_thai: string, ghi_chu?: string) =>
  sb.from('lich_zalo_gui').upsert({ loai, slot, trang_thai, ghi_chu: ghi_chu?.slice(0, 500) ?? null, luc: new Date().toISOString() }, { onConflict: 'loai,slot' })

// ---------------- Seeding: y lệnh bot.mjs tien-do ----------------
const SEED_GROUPS = ['Key Aptis miễn phí - update liên tục', 'Hội review đề Aptis có tâm'], SEED_FROM = '2026-11-05'
async function tienDo(today: string, hour: number, chot: boolean) {
  const members = (await sb.from('members').select('*').order('sort_order')).data ?? []
  const staff = members.filter((m) => m.role === 'staff' && m.active && !/^Thành viên \d/.test(m.name))
  const posts = (await sb.from('seeding_posts').select('member_id,kind').eq('date', today)).data ?? []
  const open = ((await sb.from('seed_targets').select('group_name,date,status,assigned_to,taken_by').in('status', ['new', 'taken'])).data ?? [])
    .filter((t) => SEED_GROUPS.includes(t.group_name) && t.date >= SEED_FROM)
  const thRow = (await sb.from('threads_reports').select('data').eq('ngay', today).maybeSingle()).data
  const thSeed = [...(thRow?.data?.seeding || []), ...(thRow?.data?.bai || []).filter((x: { nv?: string; link?: string }) => x.nv && x.link)]
  const thDone = (await sb.from('threads_seed_done').select('link,member_id').eq('ngay', today)).data ?? []
  const thDoneLinks = new Set(thDone.map((x) => x.link))
  const lines = [`📊 Seeding ${hour}h · ${ddmm(today)}`], warn: string[] = [], du: string[] = [], thieu: string[] = []
  let conDang = 0, conTL = 0
  for (const m of staff) {
    const mine = posts.filter((p) => p.member_id === m.id)
    const dang = mine.filter((p) => p.kind === 'post').length, tl = mine.filter((p) => p.kind === 'comment').length
    const qd = m.seeding_quota || 0, cd = Math.max(0, qd - dang)
    const ct = open.filter((t) => (t.status === 'new' && t.assigned_to === m.id) || (t.status === 'taken' && t.taken_by === m.id)).length
    conDang += cd; conTL += ct
    const ok = cd === 0 && ct === 0
    const thMine = thSeed.filter((x: { giao?: string }) => x.giao === m.id), thOk = thMine.filter((x: { link: string }) => thDoneLinks.has(x.link)).length
    const thOwn = thMine.filter((x: { nv?: string }) => x.nv), thOwnOk = thOwn.filter((x: { link: string }) => thDoneLinks.has(x.link)).length
    const th = thMine.length ? ` · Threads ${thOk}/${thMine.length}${thOwn.length ? ` (bài mình ${thOwnOk}/${thOwn.length})` : ''}` : ''
    lines.push(`${ok ? '✅ ' : ''}${m.name}: đăng ${dang}/${qd}${cd ? ` (còn ${cd})` : ''} · đã trả lời ${tl}${ct ? `, còn ${ct} bài chưa trả lời` : ', hết bài cần trả lời'}${th}`)
    if (!dang && !tl) warn.push(`⚠️ ${m.name} chưa làm bài nào hôm nay`)
    if (ok) du.push(m.name); else thieu.push(`${m.name} còn ${[cd && cd + ' bài đăng', ct && ct + ' bài trả lời'].filter(Boolean).join(', ')}`)
  }
  const chuaGiao = open.filter((t) => t.status === 'new' && !t.assigned_to).length
  lines.push(`Cả đội: còn ${conDang} bài đăng · ${conTL} bài trả lời${chuaGiao ? ` · ${chuaGiao} bài chưa giao ai` : ''}`)
  lines.push(...warn)
  if (chot) lines.push(`Chốt ngày: ${du.length ? 'đủ chỉ tiêu: ' + du.join(', ') : 'chưa ai đủ chỉ tiêu'}${thieu.length ? '. Thiếu: ' + thieu.join('; ') : ''}`)
  return lines.slice(0, 8).join('\n')
}

// Báo riêng Thiện khi lượt seeding lỗi (lượt chính: còn lượt bù; lượt bù: hết thử)
async function baoLoiSeeding(slot: number, min: number, loi: string) {
  const gio = `${Math.floor(slot / 60)}h${slot % 60 ? slot % 60 : ''}`
  const conBu = min < slot + 15
  await zaloThuLai(Deno.env.get('ZALO_CHAT_ID') ?? '', `⚠️ [Máy chủ] Báo seeding nhóm Team lượt ${gio} lỗi: ${loi.slice(0, 150)}. ${conBu ? 'Sẽ tự thử lại sau 20 phút.' : 'Đã thử lại vẫn hỏng, nhóm chưa nhận tin lượt này.'}`).catch(() => {})
}

async function guiSeeding(thu = false) {
  const { day, min } = vnParts()
  if (thu) {
    const msg = await tienDo(day, Math.floor(min / 60), false)
    const r = await zalo(Deno.env.get('ZALO_CHAT_ID') ?? '', '[Thử bản máy chủ] ' + msg)
    return r.ok ? { da_gui_thu: true } : { loi: r.loi }
  }
  // Khung 9h, 11h30, 17h, 22h; trễ tối đa 60 phút (như seeding-bao-nhom --lich)
  const slot = [540, 690, 1020, 1320].find((s) => min >= s && min < s + 60)
  if (slot == null) return { bo_qua: 'ngoài khung giờ' }
  const key = `${day}-${slot}`
  if (!(await giuCho('seeding', key))) return { bo_qua: 'khung này đã gửi' }
  try {
    const msg = await tienDo(day, Math.floor(slot / 60), slot === 1320)
    if (!msg.includes('Seeding')) throw new Error('không lấy được tiến độ')
    const to = nguoiNhan('ZALO_TEAM_ID')
    const r = await zaloThuLai(to.chat, to.tien_to + msg)
    await ghi('seeding', key, r.ok ? 'da_gui' : 'loi', r.ok ? (to.tien_to ? 'gửi riêng Thiện (song song)' : 'gửi nhóm Team') : r.loi)
    if (!r.ok) await baoLoiSeeding(slot, min, r.loi ?? '')
    return r.ok ? { da_gui: key, song_song: !!to.tien_to } : { loi: r.loi }
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e)
    await ghi('seeding', key, 'loi', loi)
    await baoLoiSeeding(slot, min, loi)
    return { loi }
  }
}

// ---------------- Cổ đông: y lịch bao-cao-co-dong-ngay-9h, gửi 8h ----------------
const tien = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ'
const tr = (n: number) => (Math.round(n / 1e5) / 10).toLocaleString('vi-VN') + 'tr'
async function soLieuCoDong() {
  const r = await fetch(`${KT_URL}/rest/v1/rpc/muse_so_lieu_co_dong`, {
    method: 'POST',
    headers: { apikey: KT_ANON, Authorization: `Bearer ${KT_ANON}`, 'Content-Type': 'application/json', 'x-cong-key': Deno.env.get('KT_CONG_KEY') ?? '' },
    body: '{}',
  })
  if (!r.ok) throw new Error('DB web Kỳ Tích ' + r.status + ': ' + (await r.text()).slice(0, 200))
  return await r.json()
}
type Num = Record<string, number>
function soanCoDong(j: Record<string, any>, D: string) {
  const R = addDays(D, -1), R0 = addDays(R, -1)
  const daily: { d: string; n: number; dt: number }[] = j.daily ?? []
  const dR = daily.find((x) => x.d === R), d0 = daily.find((x) => x.d === R0)
  const M = R.slice(0, 7), [yy, mm] = M.split('-').map(Number)
  const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate(), qua = Number(R.slice(8, 10))
  const luyKe = daily.filter((x) => x.d.startsWith(M) && x.d <= R).reduce((t, x) => t + (x.dt || 0), 0)
  const kpi = Number(j.settings?.['kpi_' + M.replace('-', '')] ?? 0)
  const pct = kpi ? (luyKe / kpi) * 100 : 0
  const items: { d: string; g: string; amt: number }[] = (j.exp_items ?? []).filter((x: { d: string }) => x.d?.startsWith(M))
  const nhom = (g: string) => items.filter((x) => x.g === g).reduce((t, x) => t + (x.amt || 0), 0)
  const cp = items.reduce((t, x) => t + (x.amt || 0), 0)
  const tot: Num = j.totals ?? {}
  const quy = (tot.fund_initial || 0) + (tot.rev || 0) - (tot.exp_paid || 0) - (tot.invest || 0) - (tot.receivable || 0)
  const unpaid: { t: string; amt: number }[] = j.unpaid ?? []
  const nu = (j.new_users ?? []).find((x: { d: string }) => x.d === R)?.n ?? 0
  const truyCap = (j.traffic_daily ?? []).find((x: { d: string }) => x.d === R)?.n ?? null
  // Kiểm bất thường (bước 3 lịch cũ)
  let batThuong = ''
  if (!dR || !dR.dt) batThuong = `doanh thu ngày ${ddmm(R)} = 0 hoặc thiếu dữ liệu`
  else if (d0?.dt) {
    const lech = (dR.dt - d0.dt) / d0.dt
    if (Math.abs(lech) > 0.7) {
      const donCung = d0.n ? Math.sign(dR.n - d0.n) === Math.sign(lech) : false
      if (!donCung) batThuong = `doanh thu lệch ${Math.round(lech * 100)}% so với ${ddmm(R0)} mà số đơn không cùng chiều`
    }
  }
  const ss = d0?.dt ? ` (${dR && dR.dt >= d0.dt ? '↑' : '↓'}${Math.abs(Math.round(((dR?.dt || 0) - d0.dt) / d0.dt * 100))}% so với ${ddmm(R0)})` : ''
  const lai = luyKe - cp
  const text = [
    `Báo cáo Aptis Kỳ Tích ngày ${ddmm(R)}`, '',
    'DOANH THU',
    `- Ngày ${ddmm(R)}: ${tien(dR?.dt || 0)} · ${dR?.n || 0} đơn${ss}`,
    `- Luỹ kế tháng ${mm}: ${tr(luyKe)} / KPI ${tr(kpi)} (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%), dự kiến cuối tháng ~${tr(luyKe / qua * dim)}`, '',
    `CHI PHÍ & LÃI THÁNG ${mm}${j.chi_phi_toi ? ` (chi phí cập nhật tới ${ddmm(j.chi_phi_toi > R ? R : j.chi_phi_toi)})` : ''}`,
    `- Chi phí tháng: ${tr(cp)} (Nhân sự ${tr(nhom('Nhân sự / CTV'))} · Hạ tầng & Tool ${tr(nhom('Hạ tầng & Tool'))} · Marketing ${tr(nhom('Marketing & Vận hành'))})`,
    `- Lãi tháng: ${lai >= 0 ? '+' : '-'}${tr(Math.abs(lai))}`,
    `- Quỹ hiện có: ${tr(quy)}${tot.exp_unpaid ? ` (chưa trả: ${tr(tot.exp_unpaid)}, ${[...new Set(unpaid.map((u) => u.t))].join(', ') || 'chi phí chưa trả'})` : ''}`, '',
    'NGƯỜI DÙNG',
    `- User mới: ${nu} · Truy cập: ${truyCap == null ? 'chưa có số' : truyCap}`,
    `- Đang trả phí: ${j.subs?.con_han ?? '-'} / ${j.subs?.tong_user ?? '-'} tài khoản`,
  ].join('\n')
  return { text, batThuong, R }
}

// Báo riêng Thiện khi báo cáo cổ đông lỗi: chỉ báo ở lượt cuối 8h50 (các lượt trước còn tự thử lại 10 phút sau)
async function baoLoiCoDong(min: number, loi: string) {
  if (min < 530) return
  await zaloThuLai(Deno.env.get('ZALO_CHAT_ID') ?? '', `⚠️ [Máy chủ] Báo cáo cổ đông hôm nay chưa gửi được vào nhóm: ${loi.slice(0, 150)}. Đã thử tới 8h50.`).catch(() => {})
}
// Tin tổng kết tháng (ngày 1), tháng = tháng của R (hôm qua). Chỉ số Kỳ Tích.
function soanThang(j: Record<string, any>, R: string) {
  const M = R.slice(0, 7), mm = M.slice(5, 7)
  const daily: { d: string; n: number; dt: number }[] = (j.daily ?? []).filter((x: { d: string }) => x.d.startsWith(M))
  const dt = daily.reduce((t, x) => t + (x.dt || 0), 0), don = daily.reduce((t, x) => t + (x.n || 0), 0)
  const PM = addDays(M + '-01', -1).slice(0, 7)
  const truoc = (j.daily ?? []).filter((x: { d: string }) => x.d.startsWith(PM))
  const dtTruoc = truoc.length >= 28 ? truoc.reduce((t: number, x: { dt: number }) => t + (x.dt || 0), 0) : 0
  const kpi = Number(j.settings?.['kpi_' + M.replace('-', '')] ?? 0)
  const items: { d: string; g: string; amt: number }[] = (j.exp_items ?? []).filter((x: { d: string }) => x.d?.startsWith(M))
  const nhom = (g: string) => items.filter((x) => x.g === g).reduce((t, x) => t + (x.amt || 0), 0)
  const cp = items.reduce((t, x) => t + (x.amt || 0), 0), lai = dt - cp
  const tot: Num = j.totals ?? {}
  const quy = (tot.fund_initial || 0) + (tot.rev || 0) - (tot.exp_paid || 0) - (tot.invest || 0) - (tot.receivable || 0)
  return [
    `Tổng kết tháng ${mm} Aptis Kỳ Tích`, '',
    `- Doanh thu cả tháng: ${tr(dt)} · ${don} đơn${dtTruoc ? ` (${dt >= dtTruoc ? '↑' : '↓'}${Math.abs(Math.round((dt - dtTruoc) / dtTruoc * 100))}% so với tháng ${PM.slice(5, 7)})` : ''}`,
    `- KPI: ${tr(kpi)}, đạt ${kpi ? Math.round(dt / kpi * 100) : 0}%`,
    `- Chi phí: ${tr(cp)} (Nhân sự ${tr(nhom('Nhân sự / CTV'))} · Hạ tầng & Tool ${tr(nhom('Hạ tầng & Tool'))} · Marketing ${tr(nhom('Marketing & Vận hành'))})`,
    `- Lãi tháng: ${lai >= 0 ? '+' : '-'}${tr(Math.abs(lai))}`,
    `- Quỹ cuối tháng: ${tr(quy)}`,
  ].join('\n')
}

async function guiCoDong(thu = false, b_thang = false) {
  const { day: D, min } = vnParts()
  if (thu) {
    const j = await soLieuCoDong()
    const { text, batThuong, R } = soanCoDong(j, D)
    const r = await zalo(Deno.env.get('ZALO_CHAT_ID') ?? '', '[Thử bản máy chủ] ' + text + (batThuong ? `\n(Bản thật sẽ GIỮ LẠI vì: ${batThuong})` : ''))
    if (r.ok && b_thang) await zalo(Deno.env.get('ZALO_CHAT_ID') ?? '', '[Thử bản máy chủ] ' + soanThang(j, R))
    return r.ok ? { da_gui_thu: true, bat_thuong: batThuong || null } : { loi: r.loi }
  }
  if (min < 480 || min >= 540) return { bo_qua: 'ngoài khung 8h-8h59' }
  if (!(await giuCho('co_dong', D))) return { bo_qua: 'hôm nay đã xử lý' }
  try {
    const j = await soLieuCoDong()
    const { text, batThuong, R } = soanCoDong(j, D)
    const thien = Deno.env.get('ZALO_CHAT_ID') ?? ''
    if (batThuong) {
      await zalo(thien, `[Bản máy chủ] Chưa gửi báo cáo cổ đông ngày ${ddmm(R)} vì số bất thường: ${batThuong}. Mày xem rồi bảo Claude gửi tay nếu ổn.`)
      await ghi('co_dong', D, 'giu_lai', batThuong)
      return { giu_lai: batThuong }
    }
    const to = nguoiNhan('ZALO_CODONG_ID')
    const r = await zaloThuLai(to.chat, to.tien_to + text)
    await ghi('co_dong', D, r.ok ? 'da_gui' : 'loi', r.ok ? (to.tien_to ? 'gửi riêng Thiện (song song)' : 'gửi nhóm Cổ đông') : r.loi)
    if (!r.ok) { await baoLoiCoDong(min, r.loi ?? ''); return { loi: r.loi } }
    // Ngày 1: thêm tin tổng kết tháng trước (1 lần, khoá riêng)
    if (D.endsWith('-01') && (await giuCho('co_dong', D + '-thang'))) {
      const r2 = await zaloThuLai(to.chat, to.tien_to + soanThang(j, R))
      await ghi('co_dong', D + '-thang', r2.ok ? 'da_gui' : 'loi', r2.ok ? 'tổng kết tháng' : r2.loi)
      if (!r2.ok) await baoLoiCoDong(min, 'tin tổng kết tháng: ' + (r2.loi ?? ''))
    }
    return { da_gui: D, song_song: !!to.tien_to }
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e)
    await ghi('co_dong', D, 'loi', loi)
    await baoLoiCoDong(min, loi)
    return { loi }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return out({ v: V })
  if (req.method !== 'POST') return out({ loi: 'Chỉ nhận POST' }, 405)
  const b = await req.json().catch(() => ({}))
  // Gửi thử ngoài giờ, chỉ riêng Thiện: cần header x-thu-key = KT_CONG_KEY
  const thu = b.thu === true
  if (thu && (!Deno.env.get('KT_CONG_KEY') || req.headers.get('x-thu-key') !== Deno.env.get('KT_CONG_KEY'))) return out({ loi: 'Sai mã thử' }, 403)
  try {
    if (b.loai === 'seeding') return out(await guiSeeding(thu))
    if (b.loai === 'co_dong') return out(await guiCoDong(thu, b.thang === true))
  } catch (e) { return out({ loi: e instanceof Error ? e.message : String(e) }, 500) }
  return out({ loi: 'loai phải là seeding hoặc co_dong' }, 400)
})
