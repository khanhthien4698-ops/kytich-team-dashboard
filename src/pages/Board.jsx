import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, longDate, monthStart, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { KIND } from './Today.jsx'
import Review, { isBad } from '../components/Review.jsx'

// Màu ô: xanh = đủ việc + đủ seeding; đỏ = không làm gì; vàng = có làm nhưng thiếu
function score(m, date, data, routines, today) {
  if (date > today) return { cls: 'n' }
  const rIds = new Set(routines.filter((r) => r.member_id === m.id && r.active).map((r) => r.id))
  const checks = data.checks.filter((c) => c.member_id === m.id && c.date === date && rIds.has(c.routine_id) && c.done)
  const extras = data.extras.filter((e) => e.member_id === m.id && e.date === date)
  const posts = data.posts.filter((p) => p.member_id === m.id && p.date === date)
  const note = data.notes.find((n) => n.member_id === m.id && n.date === date)
  const x = checks.length + extras.filter((e) => e.done).length
  const y = rIds.size + extras.length
  const a = posts.length
  const b = m.seeding_quota
  const rv = posts.map((p) => data.reviewOf[p.id]).filter(Boolean)
  const scores = rv.map((r) => r.score).filter(Boolean)
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null
  const bad = rv.filter(isBad).length
  let cls = 'y'
  if (x === 0 && a === 0 && !note) cls = 'r'
  else if (x >= y && a >= b) cls = 'g'
  return { cls, x, y, a, b, avg, bad }
}

export default function Board() {
  const notify = useToast()
  const today = vnToday()
  const [end, setEnd] = useState(today)
  const start = addDays(end, -6)
  const days = rangeDays(start, end)
  const [members, setMembers] = useState([])
  const [routines, setRoutines] = useState([])
  const [data, setData] = useState(null)
  const [month, setMonth] = useState(null)
  const [reports, setReports] = useState([])
  const [sel, setSel] = useState(null)
  const scroller = useRef(null)
  // Điện thoại: cuộn bảng sang phải để thấy ngày gần nhất trước
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth }, [data])

  const load = useCallback(async () => {
    try {
      const ms0 = monthStart(today)
      const [ms, rs, d, mo, ideas, rep, reviews] = await Promise.all([
        api.listMembers(), api.listRoutines(), api.getRange(start, end),
        api.getRange(ms0, today), api.listIdeasRange(ms0, today), api.listReports(addDays(today, -13), today), api.listReviewsSince(start),
      ])
      setMembers(ms.filter((m) => m.active && m.role === 'staff')); setRoutines(rs)
      setData({ ...d, reviewOf: Object.fromEntries(reviews.map((r) => [r.post_id, r])) }); setMonth({ ...mo, ideas }); setReports(rep.filter((r) => !r.member_id))
    } catch (x) { notify(x.message, true) }
  }, [start, end, today, notify])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 60000)
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', f) }
  }, [load])

  if (!data) return <p className="empty">Đang tải…</p>

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1>Bảng tổng 7 ngày</h1>
          <div className="sub">{ddmm(start)} – {ddmm(end)} · tự tải lại mỗi phút</div>
        </div>
        <div className="weeknav">
          <button className="btn sm ghost" onClick={() => { setEnd(addDays(end, -7)); setSel(null) }}>← Tuần trước</button>
          <button className="btn sm ghost" disabled={end >= today} onClick={() => { setEnd(end >= addDays(today, -7) ? today : addDays(end, 7)); setSel(null) }}>Tuần sau →</button>
        </div>
      </div>

      <div className="card" style={{ padding: 10 }}>
        <div className="board-scroll" ref={scroller}>
          <table className="board">
            <thead>
              <tr>
                <th className="name">Người</th>
                {days.map((d) => <th key={d} className={d === today ? 'today' : ''}>{weekday(d)}<br />{ddmm(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && <tr><td colSpan={8} className="empty">Chưa có nhân viên nào.</td></tr>}
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="name">{m.name}</td>
                  {days.map((d) => {
                    const s = score(m, d, data, routines, today)
                    const on = sel?.m.id === m.id && sel?.d === d
                    return (
                      <td key={d}>
                        {s.cls === 'n' ? <div className="cell n">—</div> : (
                          <button className={`cell ${s.cls}${on ? ' sel' : ''}`} onClick={() => setSel(on ? null : { m, d })}>
                            Việc {s.x}/{s.y}<br />Seed {s.a}/{s.b}
                            {(s.avg || s.bad > 0) && <span className="q">{s.avg ? '★' + s.avg.toFixed(1) : ''}{s.bad > 0 ? ' ⚠' + s.bad : ''}</span>}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--green-soft)', border: '1px solid var(--green)' }} />Đủ việc + đủ seeding</span>
          <span><i style={{ background: 'var(--yellow-soft)', border: '1px solid var(--yellow)' }} />Có làm, còn thiếu</span>
          <span><i style={{ background: 'var(--red-soft)', border: '1px solid var(--red)' }} />Không làm gì</span>
          <span className="sub">★ điểm bot chấm TB · ⚠ số bài bị gỡ/vi phạm · Bấm ô xem chi tiết</span>
        </div>
      </div>

      {sel && <Detail m={sel.m} d={sel.d} data={data} routines={routines} onClose={() => setSel(null)} />}

      <section className="card">
        <div className="card-h"><h2>Báo cáo sáng</h2><span className="count sub">14 ngày gần nhất</span></div>
        {reports.length === 0 && <p className="empty">Chưa có báo cáo. Bot sáng sẽ ghi vào đây mỗi ngày.</p>}
        {reports.map((r) => (
          <div key={r.id} className="report"><b>{longDate(r.date)}</b>{'\n'}{r.text}</div>
        ))}
      </section>

      {month && <MonthStats month={month} members={members} />}
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
    <section className="card" style={{ borderColor: 'var(--brown)' }}>
      <div className="card-h">
        <h2>{m.name} · {longDate(d)}</h2>
        <button className="x" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <div className="grid2">
        <div>
          <b>Việc cố định</b>
          {rs.map((r) => {
            const c = checks.find((x) => x.routine_id === r.id)
            return <div key={r.id} className="stat-row"><span>{c?.done ? '✅' : '⬜'} {r.title}{c?.note ? <span className="sub"> — {c.note}</span> : null}</span></div>
          })}
          {extras.length > 0 && <><b style={{ display: 'block', marginTop: 10 }}>Việc phát sinh</b>
            {extras.map((e) => <div key={e.id} className="stat-row"><span>{e.done ? '✅' : '⬜'} {e.title}</span></div>)}</>}
          <b style={{ display: 'block', marginTop: 10 }}>Ghi chú cuối ngày</b>
          <p style={{ margin: '4px 0' }}>{note?.note || <span className="sub">Chưa bấm “Xong ngày”.</span>}</p>
        </div>
        <div>
          <b>Seeding {posts.length}/{m.seeding_quota}</b>
          {posts.length === 0 && <p className="empty">Không có bài nào.</p>}
          {posts.map((p, i) => (
            <div key={p.id} className="post">
              <b>{i + 1}.</b>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
                <div className="meta"><span className={'pill' + (p.kind === 'comment' ? ' c' : '')}>{KIND[p.kind]}</span> {p.group_name}{p.created_at ? ' · ' + timeVN(p.created_at) : ''}</div>
                <Review r={data.reviewOf[p.id]} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function countBy(list, key) {
  const m = new Map()
  for (const x of list) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function MonthStats({ month, members }) {
  const ideaTopic = Object.fromEntries(month.ideas.map((i) => [i.id, i.topic]))
  const byPerson = members.map((m) => [m.name, month.posts.filter((p) => p.member_id === m.id).length]).sort((a, b) => b[1] - a[1])
  const byGroup = countBy(month.posts, (p) => p.group_name || 'Không rõ')
  const byTopic = countBy(month.posts, (p) => ideaTopic[p.idea_id])
  const Block = ({ title, rows, empty }) => (
    <div>
      <b>{title}</b>
      {rows.length === 0 && <p className="empty">{empty}</p>}
      {rows.slice(0, 10).map(([k, v]) => <div key={k} className="stat-row"><span>{k}</span><b>{v}</b></div>)}
    </div>
  )
  return (
    <section className="card">
      <div className="card-h"><h2>Thống kê seeding tháng này</h2><span className="count">{month.posts.length} bài</span></div>
      <div className="stats">
        <Block title="Theo người" rows={byPerson} empty="—" />
        <Block title="Theo group" rows={byGroup} empty="Chưa có bài." />
        <Block title="Theo chủ đề gợi ý" rows={byTopic} empty="Chưa có bài gắn với gợi ý." />
      </div>
    </section>
  )
}
