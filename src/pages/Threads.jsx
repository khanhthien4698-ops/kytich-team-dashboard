import { useEffect, useState } from 'react'
import { sb, listMembers, getThreadsSeeding } from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'

// Mục Threads (cả team xem, chỉ bot ghi): báo cáo của tool đăng bài Threads trên máy Thiện.
// Bot đẩy file bao-cao/<ngày>.json lên bảng threads_reports sau mỗi lượt 15 phút (scripts/bot.mjs threads-day).

const tone = (code) => (code === 'da_dang' || code === 'da_tra_loi' ? 'ok' : code === 'loi' || code === 'bi_dung' ? 'bad' : 'warn')
const hm = (ts) => (ts ? timeVN(ts) : '-')
const n = (v) => Number(v) || 0
const has = (v) => v != null && v !== '' && v !== 'None'

function Link({ href, children = 'Mở' }) {
  return has(href) ? <a href={href} target="_blank" rel="noreferrer">{children} ↗</a> : <span className="mini">-</span>
}

function Copy({ text }) {
  const notify = useToast()
  return <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(text).then(() => notify('Đã chép comment'), () => notify('Không chép được', true))}>Chép</button>
}

export default function Threads() {
  const notify = useToast()
  const today = vnToday()
  const [date, setDate] = useState(today)
  const [row, setRow] = useState(undefined)
  const [nick, setNick] = useState('')
  const [st, setSt] = useState('')
  const [open, setOpen] = useState({})
  const [seedSt, setSeedSt] = useState({ names: {}, done: null })

  useEffect(() => {
    setRow(undefined)
    sb.from('threads_reports').select('ngay,cap_nhat,data').eq('ngay', date).maybeSingle()
      .then(({ data, error }) => {
        if (!error) return setRow(data)
        // Bảng chưa tạo (chưa chạy supabase/012_threads.sql) thì báo nhẹ, không bật toast lỗi
        if (/threads_reports|schema cache|does not exist/i.test(error.message)) return setRow(false)
        notify(error.message, true); setRow(null)
      })
    // Ai được giao comment seeding nào, đã tích chưa (bảng threads_seed_done)
    Promise.all([listMembers(), getThreadsSeeding(date)])
      .then(([ms, th]) => setSeedSt({ names: Object.fromEntries(ms.map((m) => [m.id, m.name])), done: th.done && Object.fromEntries(th.done.map((x) => [x.link, x])) }))
      .catch(() => {})
  }, [date, notify])

  const head = (
    <div className="page-h">
      <div style={{ marginRight: 'auto' }}>
        <h1>Threads</h1>
        <div className="sub">{longDate(date)}{row?.cap_nhat ? ` · cập nhật lúc ${hm(row.cap_nhat)}` : ''}</div>
      </div>
      <div className="seg inline">
        <button onClick={() => setDate(addDays(date, -1))}>‹ Hôm trước</button>
        <button className={date === today ? 'on' : ''} onClick={() => setDate(today)}>Hôm nay</button>
        <button disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>Hôm sau ›</button>
      </div>
    </div>
  )
  if (row === undefined) return <>{head}<p className="empty">Đang tải...</p></>
  if (row === false) return <>{head}<section className="card"><p className="empty">Mục Threads chưa có bảng dữ liệu. Chạy file supabase/012_threads.sql xong là số liệu tự lên.</p></section></>
  if (!row) return <>{head}<section className="card"><p className="empty">Ngày này chưa có báo cáo Threads. Tool đăng bài chạy xong lượt nào thì số liệu sẽ hiện ở đây.</p></section></>

  const d = row.data || {}
  const t = d.tong || {}
  const nicks = d.nick || []
  const bai = d.bai || []
  const bl = d.binh_luan || []
  const seed = d.seeding || []
  const stList = [...new Map(bai.map((b) => [b.trang_thai, b.trang_thai_chu || b.trang_thai])).entries()]
  const shown = bai
    .filter((b) => (!nick || b.nick === nick) && (!st || b.trang_thai === st))
    .sort((a, b) => String(a.luc_dang || a.gio_du_kien).localeCompare(String(b.luc_dang || b.gio_du_kien)))
  const kpi = [['Đã đăng', t.da_dang], ['Còn chờ', t.cho], ['Lỗi', t.loi], ['Bình luận nhận', t.binh_luan_nhan], ['Đã trả lời', t.da_tra_loi]]

  return (
    <>
      {head}
      {d.tam_dung && <section className="card"><span className="chip bad">Tool đang tạm dừng</span> <span className="mini">Bài chờ sẽ chưa được đăng cho tới khi bật lại.</span></section>}

      <div className="kpis">
        {kpi.map(([l, v]) => <div key={l} className="kpi"><div className="lbl">{l}</div><div className="v" style={l === 'Lỗi' && n(v) ? { color: 'var(--red)' } : undefined}>{n(v)}</div></div>)}
      </div>

      <section className="card">
        <div className="card-h"><h2>Theo nick</h2><span className="count">{nicks.length} nick</span></div>
        <div className="board-scroll">
          <table className="eff">
            <thead><tr><th>Nick</th><th>Góc viết</th><th>Đã đăng</th><th>Còn chờ</th><th>Lỗi</th><th>Tình trạng</th></tr></thead>
            <tbody>
              {nicks.map((k) => (
                <tr key={k.ten}>
                  <td><b>{k.ten}</b><div className="mini">{has(k.threads) ? <a href={`https://www.threads.com/@${k.threads}`} target="_blank" rel="noreferrer">@{k.threads}</a> : '-'}</div></td>
                  <td>{[].concat(k.goc || []).join(', ') || '-'}</td>
                  <td>{n(k.da_dang)}</td>
                  <td>{n(k.cho)}</td>
                  <td style={n(k.loi) ? { color: 'var(--red)' } : undefined}>{n(k.loi)}</td>
                  <td>{k.bi_dung ? <span className="chip bad">Bị dừng</span> : <span className="chip ok">Đang chạy</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Từng bài</h2><span className="count">{shown.length}/{bai.length} bài</span>
          <div className="hint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={nick} onChange={(e) => setNick(e.target.value)}>
              <option value="">Tất cả nick</option>
              {nicks.map((k) => <option key={k.ten} value={k.ten}>{k.ten}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={st} onChange={(e) => setSt(e.target.value)}>
              <option value="">Mọi trạng thái</option>
              {stList.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
          </div>
        </div>
        {shown.length === 0 && <p className="empty">Không có bài nào khớp bộ lọc.</p>}
        <div className="th-list">
          {shown.map((b) => {
            const k = `${b.nick}-${b.so}`
            return (
              <div key={k} className="th-item">
                <div className="th-top">
                  <b>{hm(b.luc_dang || b.gio_du_kien)}</b>
                  <span className="mini">{has(b.luc_dang) ? 'đã đăng' : 'dự kiến'}</span>
                  <span className="chip">{b.nick}</span>
                  <span className={'chip ' + tone(b.trang_thai)}>{b.trang_thai_chu || b.trang_thai}</span>
                  {has(b.goc) && <span className="mini">{b.goc}</span>}
                  {b.nv && b.giao && <span className="chip c">Giao {seedSt.names[b.giao] || '?'} comment</span>}
                  {b.nv && b.giao && seedSt.done && (seedSt.done[b.link] ? <span className="chip ok">Đã comment {hm(seedSt.done[b.link].done_at)}</span> : <span className="chip warn">Chưa comment</span>)}
                  <span style={{ marginLeft: 'auto' }}><Link href={b.link}>Mở bài</Link></span>
                </div>
                <div className={'th-text' + (open[k] ? ' open' : '')} onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>{b.chu}</div>
                <div className="th-meta mini">
                  <span>Bình luận đầu: <span className={'chip ' + (!has(b.binh_luan_dau) || b.binh_luan_dau === 'chưa' ? 'warn' : 'ok')}>{has(b.binh_luan_dau) ? b.binh_luan_dau : 'chưa'}</span></span>
                  {n(b.so_anh) > 0 && <span>{n(b.so_anh)} ảnh</span>}
                  <span>Bình luận: {n(b.so_binh_luan)} · đã trả lời {n(b.so_da_tra_loi)}</span>
                  {has(b.loi) && <span style={{ color: 'var(--red)' }}>Lỗi: {b.loi}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Bình luận người xem để lại</h2><span className="count">{bl.length}</span></div>
        {bl.length === 0 && <p className="empty">Chưa có bình luận nào trong ngày.</p>}
        <div className="th-list">
          {bl.map((c, i) => (
            <div key={i} className="th-item">
              <div className="th-top">
                <b>{hm(c.luc)}</b>
                <span className="chip">{c.nick}</span>
                {has(c.so_bai) && <span className="mini">bài {c.so_bai}</span>}
                <span className={'chip ' + tone(c.trang_thai)}>{c.trang_thai_chu || c.trang_thai}</span>
                <span style={{ marginLeft: 'auto' }}><Link href={c.link_bai}>Mở bài</Link></span>
              </div>
              <div className="th-text open"><b>{c.nguoi || 'Người xem'}:</b> {c.noi_dung}</div>
              {has(c.tra_loi) && <div className="th-reply"><b>Đã trả lời{has(c.luc_tra_loi) ? ` lúc ${hm(c.luc_tra_loi)}` : ''}:</b> {c.tra_loi}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Comment seeding cần đăng tay</h2><span className="count">{seedSt.done ? `${seed.filter((s) => seedSt.done[s.link]).length}/${seed.length} đã comment` : seed.length}</span></div>
        {seed.length === 0 && <p className="empty">Hôm nay không có comment seeding nào.</p>}
        <div className="th-list">
          {seed.map((s, i) => (
            <div key={i} className="th-item">
              <div className="th-top">
                <span className="chip">{s.nick}</span>
                {s.giao && <span className="chip c">Giao {seedSt.names[s.giao] || '?'}</span>}
                {seedSt.done && (seedSt.done[s.link] ? <span className="chip ok">Đã comment {hm(seedSt.done[s.link].done_at)}</span> : <span className="chip warn">Chưa comment</span>)}
                {has(s.anh_url) ? <a className="mini" href={s.anh_url} target="_blank" rel="noreferrer">Mở ảnh ↗</a> : has(s.anh) && <span className="mini">kèm ảnh: {s.anh}</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}><Copy text={s.comment || ''} /><Link href={s.link}>Mở bài</Link></span>
              </div>
              <div className="th-text open">{s.comment}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
