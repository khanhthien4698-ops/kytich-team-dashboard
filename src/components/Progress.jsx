import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, monthStart } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { POST_GROUPS, TARGET_FROM } from '../pages/Today.jsx'
import { shortName } from './ui.jsx'

// Tiến độ theo ngày (Thiện yêu cầu 25/11): lọc khoảng ngày, bảng % từng người theo ngày, lịch tháng của từng người.
// % 1 ngày = (việc cố định đã tick + bài seeding (tối đa chỉ tiêu) + bài đã trả lời + comment Threads đã tích)
//          / (việc cố định + chỉ tiêu bài seeding + bài đã trả lời + bài được giao ngày đó còn chưa trả lời + comment Threads được giao)
// Đủ chỉ tiêu = 100%.

const MAX_DAYS = 62
const monthEnd = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const clsOf = (s) => (!s ? 'n' : s.pct >= 1 ? 'g' : s.units && s.done === 0 ? 'r' : 'y')
const pctTxt = (s) => (s ? Math.round(s.pct * 100) + '%' : '')

export default function Progress({ members, routines, Detail }) {
  const notify = useToast()
  const today = vnToday()
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [who, setWho] = useState(null)
  const [month, setMonth] = useState(monthStart(today))
  const [raw, setRaw] = useState(null)
  const [pick, setPick] = useState(null) // { m, d } ô đang mở chi tiết
  const onOpen = (m, d) => setPick(pick?.m.id === m.id && pick?.d === d ? null : { m, d })
  const detailData = useMemo(() => raw && { ...raw, reviewOf: Object.fromEntries(raw.reviews.map((r) => [r.post_id, r])) }, [raw])

  // Tải 1 lần cho cả bảng (from..to) và lịch (cả tháng đang xem)
  const lo = [from, month].sort()[0]
  const hiAll = [to, monthEnd(month)].sort()[1]
  const hi = hiAll > today ? today : hiAll
  const load = useCallback(async () => {
    try { setRaw(await api.getProgressRange(lo, hi, POST_GROUPS, TARGET_FROM)) } catch (x) { notify(x.message, true) }
  }, [lo, hi, notify])
  useEffect(() => { load() }, [load])

  const stat = useMemo(() => {
    if (!raw) return null
    const thDone = new Set(raw.thDone.map((x) => x.ngay + '|' + x.link))
    const out = {}
    for (const m of members) {
      const rIds = new Set(routines.filter((r) => r.member_id === m.id && r.active).map((r) => r.id))
      for (const d of rangeDays(lo, hi)) {
        const x = raw.checks.filter((c) => c.member_id === m.id && c.date === d && c.done && rIds.has(c.routine_id)).length
          + raw.extras.filter((e) => e.member_id === m.id && e.date === d && e.done).length
        const y = rIds.size + raw.extras.filter((e) => e.member_id === m.id && e.date === d).length
        const ps = raw.posts.filter((p) => p.member_id === m.id && p.date === d)
        const a = ps.filter((p) => p.kind === 'post').length, b = m.seeding_quota ?? 0
        const c = ps.filter((p) => p.kind === 'comment').length
        // Bài cần trả lời được giao ngày d mà chưa ai trả lời (hôm nay: mọi bài còn mở đang giao cho người này)
        const left = raw.open.filter((t) => (d === today ? true : t.date === d)
          && ((t.status === 'new' && t.assigned_to === m.id) || (t.status === 'taken' && t.taken_by === m.id))).length
        const th = (raw.th[d] || []).filter((i) => i.giao === m.id)
        const thOk = th.filter((i) => thDone.has(d + '|' + i.link)).length
        const units = y + b + c + left + th.length
        const done = x + Math.min(a, b) + c + thOk
        out[m.id + '|' + d] = { pct: units ? done / units : 0, units, done, x, y, a, b, c, left, th: th.length, thOk }
      }
    }
    return out
  }, [raw, members, routines, lo, hi, today])

  const setRange = (n) => { setTo(today); setFrom(addDays(today, -(n - 1))) }
  const pickFrom = (v) => { if (!v) return; setFrom(v); if (v > to) setTo(v); else if (rangeDays(v, to).length > MAX_DAYS) setTo(addDays(v, MAX_DAYS - 1)) }
  const pickTo = (v) => { if (!v) return; const t = v > today ? today : v; setTo(t); if (t < from) setFrom(t); else if (rangeDays(from, t).length > MAX_DAYS) setFrom(addDays(t, -(MAX_DAYS - 1))) }
  const days = rangeDays(from, to)
  const get = (m, d) => (d > today ? null : stat?.[m.id + '|' + d])
  const avg = (m, ds) => { const v = ds.map((d) => get(m, d)).filter(Boolean); return v.length ? v.reduce((s, x) => s + x.pct, 0) / v.length : null }
  const full = (m, ds) => ds.map((d) => get(m, d)).filter((s) => s && s.pct >= 1).length
  const sel = members.find((m) => m.id === who) || members[0]

  return (
    <section className="card prog">
      <div className="card-h"><h2>Tiến độ theo ngày</h2><span className="count sub">% hoàn thành việc trong ngày, đủ chỉ tiêu = 100%</span></div>

      <div className="prog-filter">
        <label>Từ <input type="date" value={from} max={today} onChange={(e) => pickFrom(e.target.value)} /></label>
        <label>Đến <input type="date" value={to} max={today} onChange={(e) => pickTo(e.target.value)} /></label>
        <div className="seg inline">
          {[[7, '7 ngày'], [14, '14 ngày'], [30, '30 ngày']].map(([n, l]) => (
            <button key={n} className={from === addDays(today, -(n - 1)) && to === today ? 'on' : ''} onClick={() => setRange(n)}>{l}</button>
          ))}
        </div>
      </div>

      {!stat ? <p className="empty">Đang tải…</p> : (
        <div className="prog-scroll">
          <table className="prog-tbl">
            <thead>
              <tr>
                <th className="who">Người</th>
                {days.map((d) => <th key={d} className={d === today ? 'today' : ''}><span>{weekday(d)}</span>{ddmm(d)}</th>)}
                <th className="sum">TB</th>
                <th className="sum">Đủ</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const a = avg(m, days)
                return (
                  <tr key={m.id}>
                    <th className="who"><button className="linkbtn" onClick={() => { setWho(m.id); setMonth(monthStart(to)) }}>{shortName(m.name)}</button></th>
                    {days.map((d) => {
                      const s = get(m, d)
                      return (
                        <td key={d} className={'pc ' + clsOf(s) + (pick?.m.id === m.id && pick?.d === d ? ' sel' : '')} title={s ? tip(s) : ''}>
                          <button onClick={() => s && onOpen(m, d)} disabled={!s}>{pctTxt(s)}</button>
                        </td>
                      )
                    })}
                    <td className="sum"><b>{a == null ? '-' : Math.round(a * 100) + '%'}</b></td>
                    <td className="sum">{full(m, days)}/{days.length}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <div className="cal-wrap">
          <div className="cal-head">
            <div className="seg inline">
              {members.map((m) => <button key={m.id} className={m.id === sel.id ? 'on' : ''} onClick={() => setWho(m.id)}>{shortName(m.name)}</button>)}
            </div>
            <div className="cal-nav">
              <button className="btn sm ghost" onClick={() => setMonth(monthStart(addDays(month, -1)))} aria-label="Tháng trước">‹</button>
              <b>Tháng {Number(month.slice(5, 7))}/{month.slice(0, 4)}</b>
              <button className="btn sm ghost" disabled={month >= monthStart(today)} onClick={() => setMonth(monthStart(addDays(monthEnd(month), 1)))} aria-label="Tháng sau">›</button>
            </div>
          </div>
          {stat && <Calendar m={sel} month={month} today={today} get={get} onOpen={onOpen} pick={pick} />}
        </div>
      )}
      {pick && detailData && <Detail m={pick.m} d={pick.d} data={detailData} routines={routines} onClose={() => setPick(null)} />}
    </section>
  )
}

function tip(s) {
  const p = [`Bài seeding ${s.a}/${s.b}`, `Đã trả lời ${s.c}${s.left ? `, còn ${s.left}` : ''}`]
  if (s.y) p.push(`Việc cố định ${s.x}/${s.y}`)
  if (s.th) p.push(`Threads ${s.thOk}/${s.th}`)
  return p.join(' · ')
}

function Calendar({ m, month, today, get, onOpen, pick }) {
  const days = rangeDays(month, monthEnd(month))
  const lead = (new Date(month + 'T00:00:00Z').getUTCDay() + 6) % 7 // thứ 2 đứng đầu
  const vals = days.filter((d) => d <= today).map((d) => get(m, d)).filter(Boolean)
  const full = vals.filter((s) => s.pct >= 1).length
  const avg = vals.length ? vals.reduce((s, x) => s + x.pct, 0) / vals.length : null
  return (
    <>
      <div className="cal-sum">
        <span><b>{shortName(m.name)}</b> tháng này: đủ chỉ tiêu <b>{full}/{vals.length}</b> ngày</span>
        <span>TB <b>{avg == null ? '-' : Math.round(avg * 100) + '%'}</b></span>
        <span className="cal-leg"><i className="g" /> đủ <i className="y" /> thiếu <i className="r" /> chưa làm</span>
      </div>
      <div className="cal">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={'e' + i} />)}
        {days.map((d) => {
          const s = get(m, d)
          const c = clsOf(s)
          return (
            <button key={d} className={`cal-d ${c}${d === today ? ' today' : ''}${pick?.m.id === m.id && pick?.d === d ? ' sel' : ''}`} disabled={!s} onClick={() => s && onOpen(m, d)} title={s ? tip(s) : ''}>
              <span className="cal-n">{Number(d.slice(8))}</span>
              {s && <>
                <span className="cal-p">{pctTxt(s)}</span>
                <span className={'bar' + (s.pct >= 1 ? ' full' : '')}><span style={{ width: Math.min(100, Math.round(s.pct * 100)) + '%' }} /></span>
                <span className="cal-s">{s.a}/{s.b} bài · {s.c} TL</span>
              </>}
            </button>
          )
        })}
      </div>
    </>
  )
}

