import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { KIND_SHORT as KIND, targetToday } from './Today.jsx'
import Review, { isBad } from '../components/Review.jsx'
import { initials, greet, shortName } from '../components/ui.jsx'

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
  const d = 0 // bài trả lời không có chỉ tiêu (Thiện chốt 06/11)
  const rv = posts.map((p) => data.reviewOf[p.id]).filter(Boolean)
  const scores = rv.map((r) => r.score).filter(Boolean)
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null
  const bad = rv.filter(isBad)
  const units = y + b
  const pct = units ? (x + Math.min(a, b)) / units : 0
  let cls = 'y'
  if (x === 0 && posts.length === 0 && !note) cls = 'r'
  else if (x >= y && a >= b && c >= d) cls = 'g'
  return { cls, x, y, a, b, c, d, avg, bad, note, pct }
}

export default function Board({ me, onOpen }) {
  const notify = useToast()
  const today = vnToday()
  const yday = addDays(today, -1)
  const end = today
  const start = addDays(end, -6)
  const days = rangeDays(start, end)
  const [members, setMembers] = useState([])
  const [routines, setRoutines] = useState([])
  const [data, setData] = useState(null)
  const [extra, setExtra] = useState(null)
  const [sel, setSel] = useState(null)
  const [all, setAll] = useState([])

  const load = useCallback(async () => {
    try {
      const from = start < yday ? start : yday
      const [ms, rs, d, reviews, targets, freeIdeas, skipped, reports] = await Promise.all([
        api.listMembers(), api.listRoutines(), api.getRange(from, today), api.listReviewsSince(from),
        api.listActiveTargets(today), api.countFreeIdeas(), api.listSkippedIdeasSince(today + 'T00:00:00+07:00'),
        me.role === 'admin' ? api.listReports(addDays(today, -13), today) : Promise.resolve([]),
      ])
      setAll(ms)
      setMembers(ms.filter((m) => m.active && m.role === 'staff')); setRoutines(rs)
      setData({ ...d, reviewOf: Object.fromEntries(reviews.map((r) => [r.post_id, r])) })
      setExtra({ targets, freeIdeas, skipped, reports: reports.filter((r) => !r.member_id) })
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
  const isAdmin = me.role === 'admin'
  const nameOf = Object.fromEntries(all.map((m) => [m.id, m.name]))
  const open = (m, d) => setSel(sel?.m.id === m.id && sel?.d === d ? null : { m, d })
  const sum = (k) => todayS.reduce((t, p) => t + (p.s[k] || 0), 0)
  const openNow = extra.targets.filter((t) => targetToday(t, today) && (t.status === 'new' || t.status === 'taken'))
  const leftT = openNow.length
  const leftOf = (m) => openNow.filter((t) => (t.status === 'new' && t.assigned_to === m.id) || (t.status === 'taken' && t.taken_by === m.id)).length
  // % hôm nay tính cả bài trả lời: đã trả lời / (đã trả lời + còn phải trả lời)
  const pctNow = (m, s) => { const u = s.y + s.b + s.c + leftOf(m); return u ? (s.x + Math.min(s.a, s.b) + s.c) / u : 0 }
  const teamNow = todayS.length ? todayS.reduce((t, p) => t + pctNow(p.m, p.s), 0) / todayS.length : 0
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()))

  // Điểm bot TB 7 ngày của 1 người
  const avg7 = (m) => {
    const sc = data.posts.filter((p) => p.member_id === m.id && p.date >= start).map((p) => data.reviewOf[p.id]?.score).filter(Boolean)
    return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null
  }
  const lastAct = (m) => data.posts.filter((p) => p.member_id === m.id && p.date === today).sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0]

  // "Vừa làm": bài đăng / bài trả lời / bỏ qua ý tưởng hôm nay, mới nhất trước
  const feed = [
    ...data.posts.filter((p) => p.date === today).map((p) => ({ at: p.created_at, who: p.member_id, t: p.kind === 'post' ? 'seeding bài' : 'trả lời bài', s: p.question || null, g: p.group_name, url: p.url })),
    ...extra.skipped.map((i) => ({ at: i.skipped_at, who: i.skipped_by, t: 'bỏ qua ý tưởng', s: i.question })),
  ].filter((x) => x.at).sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, 12)

  // ---- Việc của Thiện (chỉ admin) ----
  const todo = []
  const teamWorkedYday = todayS.some((p) => p.y.cls !== 'r')
  todayS.forEach(({ m, s, y }) => {
    const n = shortName(m.name)
    if (hour >= 14 && s.cls === 'r') todo.push({ c: 'r', t: `Nhắc ${n} bắt đầu làm`, s: 'Chưa có gì hôm nay', go: () => open(m, today) })
    if (y.bad?.length) todo.push({ c: 'r', t: `Xem bài bị gỡ của ${n}`, s: `${y.bad.length} bài hôm qua`, go: () => open(m, yday) })
    else if (teamWorkedYday && y.cls === 'r') todo.push({ c: 'y', t: `Hỏi ${n} vì sao hôm qua nghỉ`, s: 'Không ghi gì hôm qua', go: () => open(m, yday) })
  })

  return (
    <>
      <section className="hero ov-hero">
        <div className="hero-top">
          <div>
            <div className="hero-hello">{greet()} · {longDate(today)}</div>
            <h1>Cả đội hôm nay xong {Math.round(teamNow * 100)}%</h1>
            <div className="summary">
              <span>Đã seeding <b>{sum('a')}/{sum('b')}</b> bài</span>
              <span>Đã trả lời <b>{sum('c')}</b> bài</span>
              <span>Còn <b>{leftT}</b> bài cần trả lời</span>
              <span>Kho ý tưởng còn <b>{extra.freeIdeas}</b> câu</span>
            </div>
          </div>
        </div>
      </section>

      {members.length === 0 && <p className="empty">Chưa có nhân viên. Thiện thêm ở Cài đặt.</p>}
      <div className="people2">
        {todayS.map(({ m, s }) => {
          const a = avg7(m)
          const last = lastAct(m)
          const mine = m.id === me.id
          return (
            <div key={m.id} className={'pcard' + (mine ? ' mine' : '')} onClick={() => onOpen(m.id)} role="button" tabIndex={0}>
              <div className="phead">
                <span className="avatar">{initials(m.name)}</span>
                <div style={{ minWidth: 0 }}><b>{m.name}</b><span className="sub">{s.cls === 'r' ? 'Chưa làm gì hôm nay' : last ? `Vừa ${last.kind === 'post' ? 'đăng bài' : 'trả lời bài'} lúc ${timeVN(last.created_at)}` : 'Đang làm'}</span></div>
                <div className="pct">{Math.round(pctNow(m, s) * 100)}%</div>
              </div>
              <div className="pnums">
                <div className="pnum"><div className="lbl">Bài seeding</div><div className="v">{s.a}<small> / {s.b}</small></div></div>
                <div className="pnum"><div className="lbl">Còn phải trả lời</div><div className="v">{leftOf(m)}<small> · đã trả lời {s.c}</small></div></div>
                <div className="pnum"><div className="lbl">Điểm bot 7 ngày</div><div className="v">{a ? '★ ' + a.toFixed(1).replace('.', ',') : '—'}</div></div>
              </div>
              <div className="pfoot">
                <span>7 ngày</span>
                <div className="days7" onClick={(e) => e.stopPropagation()}>
                  {days.map((dd) => {
                    const st = dayStat(m, dd, data, routines, today)
                    return <button key={dd} className={`d ${st.cls}${sel?.m.id === m.id && sel?.d === dd ? ' sel' : ''}`} disabled={st.cls === 'n'} title={`${weekday(dd)} ${ddmm(dd)}`} onClick={() => open(m, dd)} />
                  })}
                </div>
              </div>
              <div className="cta-me">{mine ? 'Vào việc của tôi →' : `Xem việc của ${shortName(m.name)} →`}</div>
            </div>
          )
        })}
      </div>
      {sel && <Detail m={sel.m} d={sel.d} data={data} routines={routines} onClose={() => setSel(null)} />}

      {isAdmin && (
        <section className="card">
          <div className="card-h"><h2>Cần bạn xem</h2><span className="count sub">{todo.length ? `${todo.length} việc` : ''}</span></div>
          {todo.length === 0 ? <p className="empty">Không có gì cần xem. Đội đang chạy tốt.</p> : (
            <div className="next">
              {todo.slice(0, 4).map((x, i) => (
                <div key={i} className={'todo ' + x.c}>
                  <span className="dot" />
                  <div className="next-txt">{x.t}<span className="sub">{x.s}</span></div>
                  {x.go && <button className="btn sm ghost" onClick={x.go}>Xem</button>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-h"><h2>Vừa làm</h2><span className="count sub">hôm nay, mới nhất trước</span></div>
        {feed.length === 0 && <p className="empty">Hôm nay chưa ai làm gì.</p>}
        {feed.map((f, i) => (
          <div key={i} className="feed-row">
            <span className="avatar sm">{initials(nameOf[f.who] || '?')}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div><b>{shortName(nameOf[f.who] || 'Ai đó')} {f.t}</b>{f.s && <span className="feed-s"> “{f.s}”</span>}</div>
              <div className="sub">{f.g ? f.g + ' · ' : ''}{timeVN(f.at)}{f.url && <> · <a href={f.url} target="_blank" rel="noreferrer">xem ↗</a></>}</div>
            </div>
          </div>
        ))}
      </section>

      {isAdmin && extra.reports.length > 0 && (
        <details className="card more-card">
          <summary><h2>Báo cáo bot</h2><span className="sub">{longDate(extra.reports[0].date)}</span></summary>
          {extra.reports.slice(0, 5).map((r) => <div key={r.id} className="report"><b>{longDate(r.date)}</b>{'\n'}{r.text}</div>)}
        </details>
      )}
    </>
  )
}

function Detail({ m, d, data, routines, onClose }) {
  const rs = routines.filter((r) => r.member_id === m.id && r.active)
  const checks = data.checks.filter((c) => c.member_id === m.id && c.date === d)
  const extras = data.extras.filter((e) => e.member_id === m.id && e.date === d)
  const posts = data.posts.filter((p) => p.member_id === m.id && p.date === d)
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

        </div>
        <div>
          <h3>Seeding · Bài đăng {posts.filter((p) => p.kind === 'post').length}/{m.seeding_quota} · Bài trả lời {posts.filter((p) => p.kind === 'comment').length}/{m.comment_quota ?? 0}</h3>
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
