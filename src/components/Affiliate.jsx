import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, ddmm, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { initials, shortName } from './ui.jsx'

// Affiliate (Thiện yêu cầu 12/11): mỗi bạn 1 mã giảm 10% trên web Kỳ Tích. Bot sáng đọc đơn đã trả tiền có mã đó.
// Hoa hồng cố định 10% số tiền thực trả, Thiện trả tay cuối tháng rồi tick "Đã trả".
// Không hiện email, tên học viên: chỉ ngày, gói, số tiền.
const PLAN = { week: 'Gói tuần', month: 'Gói tháng', quarter: 'Gói 3 tháng', half_year: 'Gói 6 tháng' }
const vnd = (n) => (n || 0).toLocaleString('vi-VN') + 'đ'
const monthLabel = (ym) => `Tháng ${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`
function prevMonth(ym, n = 1) {
  let [y, m] = ym.split('-').map(Number)
  m -= n
  while (m < 1) { m += 12; y-- }
  return `${y}-${String(m).padStart(2, '0')}`
}

export default function Affiliate({ me, members }) {
  const notify = useToast()
  const isAdmin = me.role === 'admin'
  const thisMonth = vnToday().slice(0, 7)
  const months = useMemo(() => [0, 1, 2, 3, 4, 5].map((n) => prevMonth(thisMonth, n)), [thisMonth])
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try { setData(await api.listAffiliate(months[months.length - 1])) } catch { setData(null) }
  }, [months])
  useEffect(() => { load() }, [load])

  if (!data || !data.codes.length) return null
  const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name]))
  // Nhân viên chỉ thấy dòng của mình (RLS đã lọc; lọc thêm ở đây cho chắc)
  const codes = data.codes.filter((c) => c.active && (isAdmin || c.member_id === me.id))
    .sort((a, b) => (nameOf[a.member_id] || '').localeCompare(nameOf[b.member_id] || ''))
  const rows = codes.map((c) => {
    const orders = data.orders.filter((o) => o.member_id === c.member_id && o.month === month)
    const pay = data.payouts.find((p) => p.member_id === c.member_id && p.month === month)
    return {
      ...c, orders, paid: !!pay?.paid, paidAt: pay?.paid_at,
      revenue: orders.reduce((s, o) => s + o.amount_vnd, 0),
      commission: orders.reduce((s, o) => s + o.commission_vnd, 0),
    }
  })
  const total = rows.reduce((s, r) => s + r.commission, 0)
  const lastSync = data.orders.reduce((t, o) => (o.synced_at > t ? o.synced_at : t), '')

  async function togglePaid(r) {
    setBusy(r.member_id)
    try { await api.setAffiliatePaid(r.member_id, month, !r.paid); notify(r.paid ? 'Đã bỏ đánh dấu' : 'Đã đánh dấu đã trả'); await load() } catch (x) { notify(x.message, true) }
    setBusy(null)
  }

  return (
    <section className="card aff">
      <div className="card-h">
        <h2>Affiliate</h2>
        <select className="input aff-month" value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null) }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === thisMonth ? ' (tháng này)' : ''}</option>)}
        </select>
      </div>
      <p className="sub aff-note">
        Hoa hồng 10% số tiền học viên thực trả khi dùng mã giảm 10% của bạn. Thiện trả cuối tháng. Bot cập nhật mỗi sáng
        {lastSync ? ` (lần gần nhất ${ddmm(lastSync.slice(0, 10))} ${timeVN(lastSync)})` : ''}.
      </p>
      <div className="aff-table">
        <div className="aff-row aff-head"><span>Người</span><span>Đơn</span><span>Doanh thu</span><span>Hoa hồng</span><span>Trạng thái</span></div>
        {rows.map((r) => (
          <div key={r.code}>
            <button type="button" className={'aff-row' + (open === r.code ? ' on' : '')} onClick={() => setOpen(open === r.code ? null : r.code)} aria-expanded={open === r.code}>
              <span className="aff-who">
                <span className="avatar sm">{initials(nameOf[r.member_id] || '?')}</span>
                <span className="aff-name"><b>{shortName(nameOf[r.member_id] || '')}</b><span className="aff-code">{r.code}</span></span>
              </span>
              <span data-l="Đơn">{r.orders.length}</span>
              <span data-l="Doanh thu">{vnd(r.revenue)}</span>
              <span data-l="Hoa hồng"><b>{vnd(r.commission)}</b></span>
              <span data-l="Trạng thái">{r.commission === 0 ? <span className="sub">Chưa có</span> : r.paid ? <span className="chip ok">Đã trả</span> : <span className="chip">Chưa trả</span>}</span>
            </button>
            {open === r.code && (
              <div className="aff-detail">
                {r.orders.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có đơn nào trong {monthLabel(month).toLowerCase()}.</p> : (
                  <table className="aff-orders">
                    <thead><tr><th>Ngày</th><th>Gói</th><th>Số tiền</th><th>Hoa hồng</th></tr></thead>
                    <tbody>{r.orders.map((o) => (
                      <tr key={o.payment_id}><td>{ddmm(o.paid_at.slice(0, 10))} {timeVN(o.paid_at)}</td><td>{PLAN[o.plan_key] || o.plan_key || '—'}</td><td>{vnd(o.amount_vnd)}</td><td>{vnd(o.commission_vnd)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
                {isAdmin && r.commission > 0 && (
                  <label className="toggle aff-paid">
                    <input type="checkbox" checked={r.paid} disabled={busy === r.member_id} onChange={() => togglePaid(r)} />
                    Đã trả {vnd(r.commission)} cho {shortName(nameOf[r.member_id] || '')}{r.paid && r.paidAt ? ` (${ddmm(r.paidAt.slice(0, 10))})` : ''}
                  </label>
                )}
              </div>
            )}
          </div>
        ))}
        {isAdmin && rows.length > 1 && <div className="aff-row aff-total"><span>Cả đội</span><span>{rows.reduce((s, r) => s + r.orders.length, 0)}</span><span>{vnd(rows.reduce((s, r) => s + r.revenue, 0))}</span><span><b>{vnd(total)}</b></span><span /></div>}
      </div>
      <p className="mini aff-foot">Đơn mua bằng ưu đãi 20/11 (hết ngày 20/11) không ghi mã giảm giá nên không tính được vào bảng này.</p>
    </section>
  )
}
