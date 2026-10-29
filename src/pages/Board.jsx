import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { KIND_SHORT as KIND } from './Today.jsx'
import Review, { isBad, FLAGS } from '../components/Review.jsx'
import { Mascot, initials, greet, shortName } from '../components/ui.jsx'

// Số liệu 1 người trong 1 ngày. Màu: xanh = đủ việc + bài + comment; đỏ = không làm gì; vàng = có làm nhưng thiếu
function dayStat(m, date, data, routines, today) {
  if (date > today) return { cls: 'n' }
  const rIds = new Set(routines.filter((r) => r.member_id === m.id && r.active).map((r) => r.id))
  const checks = data.checks.filter((c) => c.member_id === m.id && c.date === date && rIds.has(c.routine_id) && c.done)
  const extras = data.extras.filter((e) => e.member_id === m.id && e.date === date)
  const posts = data.posts.filter((p) => p.member_id === m.id && p.date === date)
  const note = data.notes.find((n) => n.member_id === m.id && n.date === date)
  const x = checks.length + extras.filter((e) => e.done).length
  const y = rIds.size + extras.length
  const a = posts.filter((p) => p.kind === 'post').length
  const b = m.seeding_quota ?? 0
  const c = posts.filter((p) => p.kind === 'comment').length
  const d = m.comment_quota ?? 0
  const rv = posts.map((p) => data.reviewOf[p.id]).filter(Boolean)
  const scores = rv.map((r) => r.score).filter(Boolean)
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null
  const bad = rv.filter(isBad)
  const units = y + b + d
  const pct = units ? (x + Math.min(a, b) + Math.min(c, d)) / units : 0
  let cls = 'y'
  if (x === 0 && posts.length === 0 && !note) cls = 'r'
  else if (x >= y && a >= b && c >= d) cls = 'g'
  return { cls, x, y, a, b, c, d, avg, bad, note, pct }
}

export default function Board({ go }) {
  const notify = useToast()
  const today = vnToday()
  const yday = addDays(today, -1)
  const [end, setEnd] = useState(today)
  const start = addDays(end, -6)
  const days = rangeDays(start, end)
  const [members, setMembers] = useState([])
  const [routines, setRoutines] = useState([])
  const [data, setData] = useState(null)
  const [extra, setExtra] = useState(null)
  const [sel, setSel] = useState(null)

  const load = useCallback(async () => {
    try {
      const from = start < yday ? start : yday
      const [ms, rs, d, reviews, targets, ideas, reports, fbs] = await Promise.all([
        api.listMembers(), api.listRoutines(), api.getRange(from, today), api.listReviewsSince(from),
        api.listTargets(yday, today), api.listIdeas(today), api.listReports(addDays(today, -13), today), api.listFeedback(yday, yday),
      ])
      setMembers(ms.filter((m) => m.active && m.role === 'staff')); setRoutines(rs)
      setData({ ...d, reviewOf: Object.fromEntries(reviews.map((r) => [r.post_id, r])) })
      setExtra({ targets, ideas, reports: reports.filter((r) => !r.member_id), fbs })
    } catch (x) { notify(x.message, true) }
  }, [start, end, today, yday, notify])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 60000)
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', f) }
  }, [load])

  if (!data || !extra) return <p className="empty">Đang tải…</p>

  // ---- Hôm nay của cả team ----
  const todayS = members.map((m) => ({ m, s: dayStat(m, today, data, routines, today), y: dayStat(m, yday, data, routines, today) }))
  const sum = (k) => todayS.reduce((t, p) => t + (p.s[k] || 0), 0)
  const teamPct = todayS.length ? todayS.reduce((t, p) => t + p.s.pct, 0) / todayS.length : 0
  const weekScores = members.flatMap((m) => days.map((dd) => dayStat(m, dd, data, routines, today).avg).filter(Boolean))
  const weekAvg = weekScores.length ? weekScores.reduce((a, b) => a + b, 0) / weekScores.length : null
  const newTargets = extra.targets.filter((t) => t.status === 'new')
  const freeIdeas = extra.ideas.filter((i) => !i.taken_by)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()))

  // ---- Tích Tích nhắc việc cần chú ý ----
  const alerts = []
  todayS.forEach(({ m, s, y }) => {
    if (hour >= 14 && s.cls === 'r') alerts.push({ c: 'r', ic: '🔴', t: `${m.name} chưa làm gì hôm nay` })
    y.bad?.forEach((r) => {
      const why = r.rule_flags?.length ? r.rule_flags.map((f) => FLAGS[f] || f).join(', ') : r.status === 'hidden' ? 'bị ẩn' : 'bị gỡ'
      alerts.push({ c: 'r', ic: '⚠️', t: `Hôm qua 1 bài của ${m.name}: ${why}` })
    })
    if (y.cls === 'y' && (y.a < y.b || y.c < y.d)) {
      const miss = [y.a < y.b && `${y.b - y.a} bài`, y.c < y.d && `${y.d - y.c} comment`].filter(Boolean).join(', ')
      alerts.push({ c: 'y', ic: '🟡', t: `Hôm qua ${m.name} thiếu ${miss}` })
    }
    if (y.cls === 'r') alerts.push({ c: 'r', ic: '🔴', t: `Hôm qua ${m.name} không ghi gì` })
  })
  if (newTargets.length) alerts.push({ c: 'y', ic: '🎯', t: `${newTargets.length} bài cần comment chưa ai nhận` })
  if (freeIdeas.length) alerts.push({ c: 'y', ic: '💡', t: `${freeIdeas.length} thẻ gợi ý bài đăng chưa ai lấy` })
  if (hour >= 9 && !extra.reports.some((r) => r.date === today)) alerts.push({ c: 'y', ic: '📭', t: 'Bot chưa ghi báo cáo sáng nay' })
  const done = todayS.filter((p) => p.s.cls === 'g').map((p) => p.m.name)
  const bubble = todayS.length === 0 ? 'Chưa có nhân viên nào. Thêm ở Cài đặt nhé.'
    : `Team đang đạt ${Math.round(teamPct * 100)}% hôm nay. ` + (done.length ? `${done.join(', ')} đã đủ chỉ tiêu. ` : '') + (alerts.length ? `Có ${alerts.length} việc cần Thiện để ý.` : 'Không có gì đáng lo.')

  return (
    <>
      <section className="hero">
        <div className="hero-top">
          <Mascot who="tichtich" pose={teamPct >= 1 ? 'trophy' : alerts.some((a) => a.c === 'r') ? 'search' : 'checklist'} />
          <div>
            <div className="hero-hello">{greet()} · {longDate(today)}</div>
            <h1>Tổng quan đội nhóm</h1>
            <div className="bubble">{bubble}</div>
          </div>
        </div>
        <div className="rings">
          {todayS.slice(0, 3).map(({ m, s }) => (
            <div key={m.id} className="ring-box">
              <div className="ring" style={{ width: 64, height: 64 }}>
                <svg width="64" height="64"><circle cx="32" cy="32" r="28.5" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" /><circle cx="32" cy="32" r="28.5" fill="none" stroke={s.pct >= 1 ? '#3ddc84' : '#FEAD5F'} strokeWidth="7" strokeLinecap="round" strokeDasharray={179} strokeDashoffset={179 * (1 - s.pct)} /></svg>
                <div className="val">{Math.round(s.pct * 100)}%</div>
              </div>
              <span className="lbl">{shortName(m.name)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="kpis">
        <div className="kpi"><div className="lbl">Team hôm nay</div><div className="v">{Math.round(teamPct * 100)}<small>%</small></div></div>
        <div className="kpi"><div className="lbl">Bài đăng hôm nay</div><div className="v">{sum('a')}<small>/{sum('b')}</small></div></div>
        <div className="kpi"><div className="lbl">Comment hôm nay</div><div className="v">{sum('c')}<small>/{sum('d')}</small></div></div>
        <div className="kpi"><div className="lbl">Điểm bot chấm 7 ngày</div><div className="v">{weekAvg ? '★' + weekAvg.toFixed(1) : '—'}</div></div>
        <div className="kpi"><div className="lbl">Bài cần comment chưa nhận</div><div className="v" style={{ color: newTargets.length ? 'var(--red)' : undefined }}>{newTargets.length}</div></div>
      </div>

      <section className="card">
        <div className="card-h"><h2>🔔 Cần chú ý</h2><span className="count sub">Tích Tích tự kiểm mỗi phút</span></div>
        <div className="alerts">
          {alerts.length === 0 && <div className="alert g"><span className="ic">✅</span>Mọi thứ ổn, không có gì cần nhắc.</div>}
          {alerts.slice(0, 8).map((a, i) => <div key={i} className={'alert ' + a.c}><span className="ic">{a.ic}</span>{a.t}</div>)}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>👥 Từng người · 7 ngày</h2>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn sm ghost" onClick={() => { setEnd(addDays(end, -7)); setSel(null) }}>← Tuần trước</button>
            <button className="btn sm ghost" disabled={end >= today} onClick={() => { setEnd(end >= addDays(today, -7) ? today : addDays(end, 7)); setSel(null) }}>Tuần sau →</button>
          </div>
          <div className="hint sub">{ddmm(start)} – {ddmm(end)}. Bấm vào ô ngày để xem chi tiết việc, link seeding và điểm bot chấm.</div>
        </div>
        {members.length === 0 && <p className="empty">Chưa có nhân viên nào.</p>}
        <div className="people">
          {members.map((m) => {
            const s = dayStat(m, today, data, routines, today)
            const Bar = ({ label, n, q }) => (
              <div className="mbar"><span>{label}</span><div className={'bar' + (q > 0 && n >= q ? ' full' : '')}><span style={{ width: (q ? Math.min(100, (n / q) * 100) : n ? 100 : 0) + '%' }} /></div><span className="n">{n}/{q}</span></div>
            )
            const fb = extra.fbs.find((f) => f.member_id === m.id)
            return (
              <div key={m.id} className="person">
                <div className="person-h">
                  <span className="avatar lg">{initials(m.name)}</span>
                  <div style={{ minWidth: 0 }}><div className="name">{m.name}</div><div className="sub">Hôm nay {Math.round(s.pct * 100)}%{s.note ? ' · đã chốt ngày' : ''}</div></div>
                </div>
                <Bar label="Việc" n={s.x} q={s.y} />
                <Bar label="Bài đăng" n={s.a} q={s.b} />
                <Bar label="Comment" n={s.c} q={s.d} />
                {s.note && <div className="mini" style={{ marginTop: 6 }}>💬 “{s.note.note}”</div>}
                {fb && <details className="more"><summary>Bot góp ý hôm qua</summary><div className="mini">{fb.text}</div></details>}
                <div className="week">
                  {days.map((dd) => {
                    const st = dayStat(m, dd, data, routines, today)
                    const on = sel?.m.id === m.id && sel?.d === dd
                    return (
                      <button key={dd} className={`day ${st.cls}${on ? ' sel' : ''}`} disabled={st.cls === 'n'} onClick={() => setSel(on ? null : { m, d: dd })}
                        title={st.cls === 'n' ? '' : `Việc ${st.x}/${st.y} · Bài ${st.a}/${st.b} · Cmt ${st.c}/${st.d}`}>
                        <span>{weekday(dd)}</span><b>{dd.slice(8)}</b>
                        <span>{st.cls === 'n' ? '' : st.avg ? '★' + st.avg.toFixed(1) : st.bad?.length ? '⚠' : '·'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--green-soft)', border: '1px solid var(--green)' }} />Đủ việc + bài + comment</span>
          <span><i style={{ background: 'var(--yellow-soft)', border: '1px solid var(--yellow)' }} />Có làm, còn thiếu</span>
          <span><i style={{ background: 'var(--red-soft)', border: '1px solid var(--red)' }} />Không làm gì</span>
          <span>★ điểm bot chấm TB · ⚠ có bài bị gỡ/vi phạm</span>
        </div>
      </section>

      {sel && <Detail m={sel.m} d={sel.d} data={data} routines={routines} onClose={() => setSel(null)} />}

      <section className="card">
        <div className="card-h"><h2>📰 Báo cáo sáng của bot</h2><span className="count sub">14 ngày gần nhất</span></div>
        {extra.reports.length === 0 && <p className="empty">Chưa có báo cáo. Bot sáng sẽ ghi vào đây mỗi ngày.</p>}
        {extra.reports.slice(0, 5).map((r) => <div key={r.id} className="report"><b>{longDate(r.date)}</b>{'\n'}{r.text}</div>)}
        <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => go('effect')}>Xem hiệu quả seeding →</button>
      </section>
    </>
  )
}

function Detail({ m, d, data, routines, onClose }) {
  const rs = routines.filter((r) => r.member_id === m.id && r.active)
  const checks = data.checks.filter((c) => c.member_id === m.id && c.date === d)
  const extras = data.extras.filter((e) => e.member_id === m.id && e.date === d)
  const posts = data.posts.filter((p) => p.member_id === m.id && p.date === d)
  const note = data.notes.find((n) => n.member_id === m.id && n.date === d)
  return (
    <section className="card" style={{ border: '2px solid var(--brown)' }}>
      <div className="card-h">
        <span className="avatar">{initials(m.name)}</span>
        <h2>{m.name} · {longDate(d)}</h2>
        <button className="x" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <div className="grid2">
        <div>
          <h3>Việc</h3>
          {rs.map((r) => {
            const c = checks.find((x) => x.routine_id === r.id)
            return <div key={r.id} className="stat-row"><span>{c?.done ? '✅' : '⬜'} {r.title}{c?.note ? <span className="sub"> — {c.note}</span> : null}</span></div>
          })}
          {extras.map((e) => <div key={e.id} className="stat-row"><span>{e.done ? '✅' : '⬜'} {e.title} <span className="sub">(phát sinh)</span></span></div>)}
          <h3 style={{ marginTop: 14 }}>Chốt ngày</h3>
          <p style={{ margin: '4px 0' }}>{note?.note || <span className="sub">Chưa chốt ngày.</span>}</p>
        </div>
        <div>
          <h3>Seeding · Bài {posts.filter((p) => p.kind === 'post').length}/{m.seeding_quota} · Comment {posts.filter((p) => p.kind === 'comment').length}/{m.comment_quota ?? 0}</h3>
          {posts.length === 0 && <p className="empty">Không có link nào.</p>}
          {posts.map((p, i) => (
            <div key={p.id} className="post">
              <span className={'num' + (p.kind === 'comment' ? ' c' : '')}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a className="link" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
                <div className="meta"><span className={'chip' + (p.kind === 'comment' ? ' c' : '')}>{KIND[p.kind]}</span>{p.group_name}{p.created_at && <span>· {timeVN(p.created_at)}</span>}</div>
                {p.question && <div className="meta">Bài gốc: {p.question}</div>}
                <Review r={data.reviewOf[p.id]} kind={p.kind} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
