import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { shortName } from './ui.jsx'

// Lịch đi làm theo tuần (Thiện yêu cầu 12/11, SQL 009).
// Người có "Điền lịch tuần" điền lịch TUẦN SAU vào thứ 7 và Chủ nhật, mỗi ngày chọn ca sáng / chiều.
// Nộp rồi không sửa được; muốn đổi thì nhắn Thiện, Thiện sửa ở trang Cả đội.
const SHIFTS = [['sang', 'Sáng'], ['chieu', 'Chiều']]

// Thứ 2 của tuần chứa ngày iso
export function mondayOf(iso) {
  const i = new Date(iso + 'T00:00:00Z').getUTCDay() // 0 = CN
  return addDays(iso, i === 0 ? -6 : 1 - i)
}
const weekDays = (mon) => rangeDays(mon, addDays(mon, 6))
const isWeekend = (iso) => ['T7', 'CN'].includes(weekday(iso))
// Bản demo: thêm ?lichmo vào link để thử điền lịch ngày thường
const demoOpen = () => api.DEMO && typeof location !== 'undefined' && location.search.includes('lichmo')
const shiftText = (arr) => (arr?.length ? SHIFTS.filter(([k]) => arr.includes(k)).map(([, v]) => v).join(' + ') : 'Nghỉ')

// Chọn ca cho 7 ngày (dùng chung cho nhân viên nộp lịch và Thiện sửa)
function DayPicker({ mon, days, setDays, disabled }) {
  const flip = (d, k) => setDays((x) => {
    const cur = x[d] || []
    return { ...x, [d]: cur.includes(k) ? cur.filter((s) => s !== k) : [...cur, k] }
  })
  return (
    <div className="sch-pick">
      {weekDays(mon).map((d) => (
        <div key={d} className="sch-day">
          <span className="sch-date"><b>{weekday(d)}</b> {ddmm(d)}</span>
          <span className="sch-btns">
            {SHIFTS.map(([k, v]) => (
              <button key={k} type="button" disabled={disabled} aria-pressed={(days[d] || []).includes(k)}
                className={'sch-shift' + ((days[d] || []).includes(k) ? ' on' : '')} onClick={() => flip(d, k)}>{v}</button>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function WeekView({ mon, days }) {
  return (
    <div className="sch-view">
      {weekDays(mon).map((d) => (
        <div key={d} className={'sch-day' + ((days?.[d] || []).length ? '' : ' off')}>
          <span className="sch-date"><b>{weekday(d)}</b> {ddmm(d)}</span>
          <span>{shiftText(days?.[d])}</span>
        </div>
      ))}
    </div>
  )
}

// ---- Thẻ của nhân viên ở "Việc của tôi" ----
export function MySchedule({ me }) {
  const notify = useToast()
  const today = vnToday()
  const thisMon = mondayOf(today)
  const nextMon = addDays(thisMon, 7)
  const open = isWeekend(today) || demoOpen()
  const [rows, setRows] = useState(null)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState(open ? 'next' : 'this')

  const load = useCallback(async () => setRows(await api.listSchedules([thisMon, nextMon], me.id)), [thisMon, nextMon, me.id])
  useEffect(() => { load() }, [load])
  if (!me.fills_schedule || !rows) return null

  const mine = (w) => rows.find((r) => r.week_start === w)
  const next = mine(nextMon), cur = mine(thisMon)

  async function submit() {
    const n = weekDays(nextMon).filter((d) => (draft[d] || []).length).length
    if (!confirm(`Nộp lịch tuần ${ddmm(nextMon)}–${ddmm(addDays(nextMon, 6))}: đi làm ${n} ngày.\nNộp rồi KHÔNG sửa được, muốn đổi phải nhắn Thiện. Nộp nhé?`)) return
    setBusy(true)
    try { await api.submitSchedule(me.id, nextMon, draft); notify('Đã nộp lịch tuần sau'); await load() } catch (x) { notify(x.message, true) }
    setBusy(false)
  }

  return (
    <section className="card sch">
      <div className="card-h">
        <h2>🗓️ Lịch đi làm</h2>
        <div className="seg">
          <button className={tab === 'this' ? 'on' : ''} onClick={() => setTab('this')}>Tuần này</button>
          <button className={tab === 'next' ? 'on' : ''} onClick={() => setTab('next')}>Tuần sau{open && !next ? ' •' : ''}</button>
        </div>
      </div>
      {tab === 'this' && (cur ? <WeekView mon={thisMon} days={cur.days} /> : <p className="empty">Tuần này bạn chưa có lịch trên dashboard.</p>)}
      {tab === 'next' && (next ? (
        <>
          <p className="sub sch-note">Đã nộp lúc {timeVN(next.submitted_at)} {ddmm(next.submitted_at.slice(0, 10))}. Muốn đổi lịch thì nhắn Thiện.</p>
          <WeekView mon={nextMon} days={next.days} />
        </>
      ) : open ? (
        <>
          <p className="sub sch-note">Chọn ca đi làm từng ngày của tuần {ddmm(nextMon)}–{ddmm(addDays(nextMon, 6))}. Ngày không chọn là nghỉ. Hạn nộp: hết Chủ nhật. Nộp rồi không sửa được.</p>
          <DayPicker mon={nextMon} days={draft} setDays={setDraft} disabled={busy} />
          <button className="btn sch-submit" disabled={busy} onClick={submit}>Nộp lịch tuần sau</button>
        </>
      ) : (
        <p className="empty">Thứ 7 và Chủ nhật mới mở điền lịch tuần sau. Lỡ hạn thì nhắn Thiện.</p>
      ))}
    </section>
  )
}

// ---- Bảng cả đội ở trang Cả đội: Thiện xem và sửa ----
export function TeamSchedule({ me, members }) {
  const notify = useToast()
  const isAdmin = me.role === 'admin'
  const today = vnToday()
  const thisMon = mondayOf(today)
  const nextMon = addDays(thisMon, 7)
  const [week, setWeek] = useState(isWeekend(today) ? nextMon : thisMon)
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null) // { member, days }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setRows(await api.listSchedules([thisMon, nextMon])), [thisMon, nextMon])
  useEffect(() => { load() }, [load])

  const people = members.filter((m) => m.fills_schedule)
  if (!isAdmin || !rows || !people.length) return null
  const of = (m) => rows.find((r) => r.member_id === m.id && r.week_start === week)
  const missing = week === nextMon ? people.filter((m) => !of(m)) : []

  async function save() {
    setBusy(true)
    try { await api.adminSaveSchedule(edit.member.id, week, edit.days); notify('Đã sửa lịch của ' + shortName(edit.member.name)); setEdit(null); await load() } catch (x) { notify(x.message, true) }
    setBusy(false)
  }

  return (
    <section className="card sch">
      <div className="card-h">
        <h2>🗓️ Lịch đi làm</h2>
        <div className="seg">
          <button className={week === thisMon ? 'on' : ''} onClick={() => { setWeek(thisMon); setEdit(null) }}>Tuần này</button>
          <button className={week === nextMon ? 'on' : ''} onClick={() => { setWeek(nextMon); setEdit(null) }}>Tuần sau</button>
        </div>
      </div>
      <p className="sub sch-note">
        Tuần {ddmm(week)}–{ddmm(addDays(week, 6))}. Các bạn tự nộp vào thứ 7 và Chủ nhật, nộp rồi không sửa được; ai xin đổi thì bấm Sửa.
        {missing.length > 0 && <> <b className="sch-miss">Chưa nộp: {missing.map((m) => shortName(m.name)).join(', ')}.</b></>}
      </p>
      <div className="sch-table" style={{ '--n': people.length }}>
        <div className="sch-row sch-head">
          <span />
          {people.map((m) => (
            <span key={m.id} className="sch-person">
              <b>{shortName(m.name)}</b>
              <button className="linkbtn" onClick={() => setEdit({ member: m, days: { ...(of(m)?.days || {}) } })}>Sửa</button>
            </span>
          ))}
        </div>
        {weekDays(week).map((d) => (
          <div key={d} className={'sch-row' + (d === today ? ' today' : '')}>
            <span className="sch-date"><b>{weekday(d)}</b> {ddmm(d)}</span>
            {people.map((m) => {
              const r = of(m)
              const v = r?.days?.[d]
              return <span key={m.id} className={'sch-cell' + (!r ? ' none' : v?.length ? '' : ' off')}>{r ? shiftText(v) : '—'}</span>
            })}
          </div>
        ))}
      </div>
      {edit && (
        <div className="sch-edit">
          <div className="sch-edit-h"><b>Sửa lịch của {shortName(edit.member.name)}</b><span className="sub"> · tuần {ddmm(week)}–{ddmm(addDays(week, 6))}</span></div>
          <DayPicker mon={week} days={edit.days} setDays={(f) => setEdit((e) => ({ ...e, days: typeof f === 'function' ? f(e.days) : f }))} disabled={busy} />
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={save}>Lưu lịch</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => setEdit(null)}>Huỷ</button>
          </div>
        </div>
      )}
    </section>
  )
}
