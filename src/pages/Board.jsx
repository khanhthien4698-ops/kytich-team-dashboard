import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { KIND_SHORT as KIND } from './Today.jsx'
import Review, { isBad } from '../components/Review.jsx'
import { Mascot, Ring, initials, greet, shortName } from '../components/ui.jsx'

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

  const todayS = members.map((m) => ({ m, s: dayStat(m, today, data, routines, today), y: dayStat(m, yday, data, routines, today) }))
  const teamPct = todayS.length ? todayS.reduce((t, p) => t + p.s.pct, 0) / todayS.length : 0
  const working = todayS.filter((p) => p.s.cls !== 'r').length
  const newTargets = extra.targets.filter((t) => t.status === 'new').length
  const freeIdeas = extra.ideas.filter((i) => !i.taken_by).length
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()))
  const open = (m, d) => setSel(sel?.m.id === m.id && sel?.d === d ? null : { m, d })

  // ---- Việc của Thiện: ngắn, mỗi dòng 1 hành động ----
  const todo = []
  todayS.forEach(({ m, s, y }) => {
    const n = shortName(m.name)
    if (hour >= 14 && s.cls === 'r') todo.push({ c: 'r', t: `Nhắc ${n} bắt đầu làm`, s: 'Chưa có gì hôm nay', go: () => open(m, today) })
    if (y.bad?.length) todo.push({ c: 'r', t: `Xem bài bị gỡ của ${n}`, s: `${y.bad.length} bài hôm qua`, go: () => open(m, yday) })
    else if (y.cls === 'r') todo.push({ c: 'y', t: `Hỏi ${n} vì sao hôm qua nghỉ`, s: 'Không ghi gì hôm qua', go: () => open(m, yday) })
  })
  if (newTargets + freeIdeas > 0) todo.push({ c: 'y', t: 'Nhắc team nhận việc', s: `${newTargets} bài cần comment · ${freeIdeas} thẻ gợi ý chưa ai nhận` })
  const pose = teamPct >= 1 ? 'trophy' : todo.some((a) => a.c === 'r') ? 'search' : 'cheer'

  return (
    <>
      <section className="hero ov-hero">
        <div className="hero-top">
          <Mascot who="tichtich" pose={pose} />
          <div>
            <div className="hero-hello">{greet()} · {longDate(today)}</div>
            <div className="big-pct">{Math.round(teamPct * 100)}<small>%</small></div>
            <div className="ov-line">team hoàn thành hôm nay · {working}/{todayS.length} bạn đang làm</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Việc của Thiện</h2><span className="count sub">{todo.length ? `${todo.length} việc` : ''}</span></div>
        {todo.length === 0 ? (
          <div className="all-done"><Mascot who="tichtich" pose="cheer" className="" /><div><h3>Không có gì cần làm</h3><div className="sub">Team đang chạy ổn.</div></div></div>
        ) : (
          <div className="next">
            {todo.slice(0, 4).map((a, i) => (
              <div key={i} className={'todo ' + a.c}>
                <span className="dot" />
                <div className="next-txt">{a.t}<span className="sub">{a.s}</span></div>
                {a.go && <button className="btn sm ghost" onClick={a.go}>Xem</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Đội nhóm</h2>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn sm ghost" aria-label="Tuần trước" onClick={() => { setEnd(addDays(end, -7)); setSel(null) }}>‹</button>
            <span className="sub" style={{ whiteSpace: 'nowrap' }}>{ddmm(start)}–{ddmm(end)}</span>
            <button className="btn sm ghost" aria-label="Tuần sau" disabled={end >= today} onClick={() => { setEnd(end >= addDays(today, -7) ? today : addDays(end, 7)); setSel(null) }}>›</button>
          </div>
        </div>
        {members.length === 0 && <p className="empty">Chưa có nhân viên. Thêm ở Cài đặt.</p>}
        <div className="plist">
          {todayS.map(({ m, s }) => {
            const status = s.cls === 'g' ? ['ok', 'Đủ'] : s.cls === 'r' ? ['bad', 'Chưa làm'] : ['warn', 'Đang làm']
            return (
              <div key={m.id}>
                <div className={'prow' + (sel?.m.id === m.id ? ' on' : '')} onClick={() => open(m, today)}>
                  <Ring value={Math.round(s.pct * 100)} total={100} size={52} stroke={6} track="#f6e6dd">{Math.round(s.pct * 100)}<small>%</small></Ring>
                  <div style={{ minWidth: 0 }}>
                    <div className="prow-name">{m.name} <span className={'chip ' + status[0]}>{status[1]}</span></div>
                    <div className="prow-stats">
                      <span title="Việc">☑️ {s.x}/{s.y}</span>
                      <span title="Bài đăng">📝 {s.a}/{s.b}</span>
                      <span title="Comment">💬 {s.c}/{s.d}</span>
                    </div>
                    <div className="days7" onClick={(e) => e.stopPropagation()}>
                    {days.map((dd) => {
                      const st = dayStat(m, dd, data, routines, today)
                      return <button key={dd} className={`d ${st.cls}${sel?.m.id === m.id && sel?.d === dd ? ' sel' : ''}`} disabled={st.cls === 'n'} title={`${weekday(dd)} ${ddmm(dd)}`} onClick={() => open(m, dd)} />
                    })}
                    </div>
                  </div>
                </div>
                {sel?.m.id === m.id && <Detail m={sel.m} d={sel.d} data={data} routines={routines} onClose={() => setSel(null)} />}
              </div>
            )
          })}
        </div>
        <div className="mini" style={{ marginTop: 8 }}>Chấm màu = 7 ngày: <b style={{ color: 'var(--green)' }}>xanh</b> đủ · <b style={{ color: 'var(--yellow)' }}>vàng</b> thiếu · <b style={{ color: 'var(--red)' }}>đỏ</b> không làm. Bấm để xem.</div>
      </section>

      <details className="card more-card">
        <summary><h2>Báo cáo bot</h2><span className="sub">{extra.reports.length ? longDate(extra.reports[0].date) : 'chưa có'}</span></summary>
        {extra.reports.slice(0, 5).map((r) => <div key={r.id} className="report"><b>{longDate(r.date)}</b>{'\n'}{r.text}</div>)}
        <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => go('effect')}>Xem hiệu quả seeding →</button>
      </details>
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
    <section className="pdetail">
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
