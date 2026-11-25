import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, rangeDays, ddmm, weekday } from '../lib/date.js'
import { useToast } from '../App.jsx'

// KPI EPIX trên Cả đội (Thiện chốt 25/11/2026).
// Đợt 26/11 - 05/12: 20.000 lượt truy cập web, 3.000 user mới; group Zalo và group Facebook mỗi nhóm 1.000 thành viên.
// Truy cập = lượt khách (visitors), user mới = tài khoản tạo trong ngày giờ VN, cách đếm giống báo cáo cổ đông.
// Số web do lịch tự động ghi vào epix_kpi_ngay; số group Thiện nhập tay ở đây.
export const EPIX = { tu: '2026-11-26', den: '2026-12-05', truyCap: 20000, userMoi: 3000, zalo: 1000, fb: 1000 }
const KENH = { zalo: 'Group Zalo', fb: 'Group Facebook' }
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('vi-VN'))
const pctOf = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)

export default function KpiEpix({ me }) {
  const notify = useToast()
  const today = vnToday()
  const isAdmin = me.role === 'admin'
  const [web, setWeb] = useState(null)
  const [grp, setGrp] = useState([])
  const [f, setF] = useState({ d: today, zalo: '', fb: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.sb.from('epix_kpi_ngay').select('d,truy_cap,user_moi,cap_nhat').order('d'),
      api.sb.from('epix_group_ngay').select('d,kenh,so_tv').order('d'),
    ])
    if (a.error || b.error) { setWeb(false); return }
    setWeb(a.data); setGrp(b.data)
  }, [])
  useEffect(() => { load() }, [load])

  if (web === null) return null
  if (web === false) return <section className="card"><div className="card-h"><h2>KPI EPIX</h2></div><p className="empty">Chưa tải được số KPI EPIX. Thử tải lại trang.</p></section>

  const started = today >= EPIX.tu
  const days = rangeDays(EPIX.tu, EPIX.den)
  const total = days.length
  const idx = days.indexOf(today)
  const passed = !started ? 0 : idx < 0 ? total : idx + 1 // số ngày đã chạy, tính cả hôm nay
  const left = !started ? total : idx < 0 ? 0 : total - idx // số ngày còn lại, tính cả hôm nay
  const doneDays = !started ? 0 : idx < 0 ? total : idx // ngày đã trọn (tới hết hôm qua), để xét đúng tiến độ
  const inWin = web.filter((r) => r.d >= EPIX.tu && r.d <= EPIX.den)
  const sum = (k) => inWin.reduce((t, r) => t + (r[k] || 0), 0)
  const todayRow = web.find((r) => r.d === today)
  const allTime = (k) => web.reduce((t, r) => t + (r[k] || 0), 0)
  const firstDay = web[0]?.d
  const lastUpd = web.reduce((m, r) => (r.cap_nhat > m ? r.cap_nhat : m), '')
  const lastOf = (kenh) => [...grp].reverse().find((g) => g.kenh === kenh && g.d <= today)
  const prevOf = (kenh, d) => [...grp].reverse().find((g) => g.kenh === kenh && g.d < d)

  const webItem = (k, label, goal) => {
    const done = sum(k)
    const need = left ? Math.ceil(Math.max(0, goal - done) / left) : 0
    const onPace = done >= (goal * doneDays) / total
    return (
      <div className="epx-item" key={k}>
        <div className="lbl">{label}</div>
        <div className="v">{fmt(done)}<small> / {fmt(goal)}</small></div>
        <div className="bar"><span style={{ width: pctOf(done, goal) + '%' }} /></div>
        <div className="sub">
          Hôm nay <b>{fmt(todayRow?.[k] ?? 0)}</b>
          {started && today <= EPIX.den && done < goal && <> · cần <b>{fmt(need)}</b>/ngày</>}
          {doneDays > 0 && <span className={'chip ' + (onPace ? 'ok' : 'warn')}>{onPace ? 'Đúng tiến độ' : 'Đang chậm'}</span>}
        </div>
        <div className="mini">Tổng từ {firstDay ? ddmm(firstDay) : '-'}: {fmt(allTime(k))}</div>
      </div>
    )
  }

  const grpItem = (kenh) => {
    const goal = EPIX[kenh]
    const last = lastOf(kenh)
    const prev = last && prevOf(kenh, last.d)
    const diff = last && prev ? last.so_tv - prev.so_tv : null
    return (
      <div className="epx-item" key={kenh}>
        <div className="lbl">{KENH[kenh]}</div>
        <div className="v">{fmt(last?.so_tv)}<small> / {fmt(goal)}</small></div>
        <div className="bar"><span style={{ width: pctOf(last?.so_tv || 0, goal) + '%' }} /></div>
        <div className="sub">
          {last ? <>Số ngày {ddmm(last.d)}{diff != null && <> · <b>{diff >= 0 ? '+' : ''}{fmt(diff)}</b> so với {ddmm(prev.d)}</>}</> : 'Chưa nhập số'}
        </div>
      </div>
    )
  }

  const save = async () => {
    const rows = ['zalo', 'fb'].filter((k) => String(f[k]).trim() !== '').map((k) => ({ d: f.d, kenh: k, so_tv: Number(f[k]), member_id: me.id, luc: new Date().toISOString() }))
    if (!rows.length) return notify('Nhập ít nhất một số thành viên', true)
    if (rows.some((r) => !Number.isInteger(r.so_tv) || r.so_tv < 0)) return notify('Số thành viên phải là số nguyên, không âm', true)
    if (!f.d || f.d > today) return notify('Chọn ngày từ hôm nay trở về trước', true)
    setBusy(true)
    const { error } = await api.sb.from('epix_group_ngay').upsert(rows, { onConflict: 'd,kenh' })
    setBusy(false)
    if (error) return notify(error.message, true)
    notify('Đã lưu số thành viên group'); setF({ ...f, zalo: '', fb: '' }); load()
  }

  const grpOn = (d, k) => grp.find((g) => g.d === d && g.kenh === k)?.so_tv
  const rowOf = (d) => web.find((r) => r.d === d)

  return (
    <section className="card epx">
      <div className="card-h">
        <h2>KPI EPIX</h2>
        <span className="count sub">Đợt {ddmm(EPIX.tu)} - {ddmm(EPIX.den)} · {started ? (today > EPIX.den ? 'đã hết đợt' : `ngày ${passed}/${total}`) : `bắt đầu đếm từ ${ddmm(EPIX.tu)}`}</span>
      </div>
      <div className="epx-grid">
        {webItem('truy_cap', 'Lượt truy cập web', EPIX.truyCap)}
        {webItem('user_moi', 'User mới', EPIX.userMoi)}
        {grpItem('zalo')}
        {grpItem('fb')}
      </div>
      <p className="mini epx-note">Số web lấy từ thống kê web EPIX, cách đếm giống báo cáo cổ đông, tự cập nhật vài lần mỗi ngày{lastUpd ? `, lần gần nhất ${new Date(lastUpd).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : ''}.</p>

      {isAdmin && (
        <div className="epx-form">
          <b>Nhập số thành viên group</b>
          <div className="epx-fields">
            <label>Ngày<input className="input" type="date" value={f.d} max={today} onChange={(e) => setF({ ...f, d: e.target.value })} /></label>
            <label>Group Zalo<input className="input" inputMode="numeric" placeholder={lastOf('zalo')?.so_tv ?? 'VD 450'} value={f.zalo} onChange={(e) => setF({ ...f, zalo: e.target.value.replace(/\D/g, '') })} /></label>
            <label>Group Facebook<input className="input" inputMode="numeric" placeholder={lastOf('fb')?.so_tv ?? 'VD 520'} value={f.fb} onChange={(e) => setF({ ...f, fb: e.target.value.replace(/\D/g, '') })} /></label>
            <button className="btn" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
          </div>
        </div>
      )}

      <details className="more">
        <summary>Bảng theo ngày</summary>
        <div className="epx-tbl">
          <table>
            <thead><tr><th>Ngày</th><th className="n">Truy cập</th><th className="n">User mới</th><th className="n">Zalo</th><th className="n">Facebook</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className={d === today ? 'now' : d > today ? 'future' : ''}>
                  <td>{weekday(d)} {ddmm(d)}</td>
                  <td className="n">{d > today ? '' : fmt(rowOf(d)?.truy_cap ?? 0)}</td>
                  <td className="n">{d > today ? '' : fmt(rowOf(d)?.user_moi ?? 0)}</td>
                  <td className="n">{fmt(grpOn(d, 'zalo')).replace(/^-$/, '')}</td>
                  <td className="n">{fmt(grpOn(d, 'fb')).replace(/^-$/, '')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Cộng</td><td className="n">{fmt(sum('truy_cap'))}</td><td className="n">{fmt(sum('user_moi'))}</td><td /><td /></tr></tfoot>
          </table>
        </div>
      </details>
    </section>
  )
}
