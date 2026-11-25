import { useEffect, useState } from 'react'
import { sb, listMembers, getThreadsSeeding } from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'
import KhoBai from '../components/KhoBai.jsx'

// Mục Threads (cả team xem, chỉ bot ghi): báo cáo của tool đăng bài Threads trên máy Thiện.
// Bot đẩy file bao-cao/<ngày>.json lên bảng threads_reports sau mỗi lượt 15 phút (scripts/bot.mjs threads-day).

const tone = (code) => (code === 'da_dang' || code === 'da_tra_loi' ? 'ok' : code === 'loi' || code === 'bi_dung' ? 'bad' : 'warn')
const hm = (ts) => (ts ? timeVN(ts) : '-')
const n = (v) => Number(v) || 0
const has = (v) => v != null && v !== '' && v !== 'None'
const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString('vi-VN'))
// Tương tác = thích + trả lời + đăng lại + trích dẫn + chia sẻ (không tính lượt xem)
const tuongTac = (s) => (s ? ['likes', 'replies', 'reposts', 'quotes', 'shares'].reduce((a, k) => a + n(s[k]), 0) : null)
const SO_LIEU = [['views', 'Lượt xem'], ['likes', 'Thích'], ['replies', 'Trả lời'], ['reposts', 'Đăng lại'], ['quotes', 'Trích dẫn'], ['shares', 'Chia sẻ']]

// Đường lượt xem 7 ngày (tong.so_lieu.views của từng ngày), SVG tự vẽ, ngày chưa có số thì bỏ trống
function ViewsLine({ pts }) {
  const W = 640, H = 150, P = { l: 44, r: 12, t: 14, b: 26 }
  const vals = pts.map((p) => p.v).filter((v) => v != null)
  if (!vals.length) return <p className="empty">Chưa có số lượt xem ngày nào trong 7 ngày này.</p>
  const max = Math.max(...vals, 1)
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(pts.length - 1, 1)
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b)
  const segs = []; let cur = []
  pts.forEach((p, i) => { if (p.v == null) { if (cur.length) segs.push(cur); cur = [] } else cur.push(`${x(i)},${y(p.v)}`) })
  if (cur.length) segs.push(cur)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Lượt xem 7 ngày">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" /><text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3, #888)">{fmt(Math.round(max * f))}</text></g>)}
      {segs.map((sg, i) => <polyline key={i} points={sg.join(' ')} fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinejoin="round" />)}
      {pts.map((p, i) => <g key={p.d}>
        {p.v != null && <circle cx={x(i)} cy={y(p.v)} r="3.5" fill="var(--red)"><title>{`${p.d.slice(8)}/${p.d.slice(5, 7)}: ${fmt(p.v)} lượt xem`}</title></circle>}
        <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3, #888)">{p.d.slice(8)}/{p.d.slice(5, 7)}</text>
      </g>)}
    </svg>
  )
}

function Link({ href, children = 'Mở' }) {
  return has(href) ? <a href={href} target="_blank" rel="noreferrer">{children} ↗</a> : <span className="mini">-</span>
}

function Copy({ text }) {
  const notify = useToast()
  return <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(text).then(() => notify('Đã chép comment'), () => notify('Không chép được', true))}>Chép</button>
}

// Tab Threads (Thiện 25/11): kho bài EPIX đăng tay ở trên; báo cáo tool đăng bài Kỳ Tích cũ ẩn đi
// (chỉ ẩn giao diện, dữ liệu và bot giữ nguyên). Quản lý vẫn mở xem được ở cuối trang.
export default function Threads({ me }) {
  const [old, setOld] = useState(false)
  return (
    <>
      <div className="page-h"><div><h1>Threads</h1><div className="sub">Kho bài EPIX đăng tay, chỉ tiêu 15 bài/ngày</div></div></div>
      <KhoBai me={me} />
      {me.role === 'admin' && (
        <section className="card">
          <button className="btn ghost sm" onClick={() => setOld(!old)}>{old ? 'Ẩn báo cáo tool cũ' : 'Xem báo cáo tool đăng bài cũ'}</button>
        </section>
      )}
      {old && me.role === 'admin' && <OldReport />}
    </>
  )
}

function OldReport() {
  const notify = useToast()
  const today = vnToday()
  const [date, setDate] = useState(today)
  const [row, setRow] = useState(undefined)
  const [nick, setNick] = useState('')
  const [st, setSt] = useState('')
  const [open, setOpen] = useState({})
  const [seedSt, setSeedSt] = useState({ names: {}, done: null })
  const [sortBy, setSortBy] = useState('gio')
  const [trend, setTrend] = useState([])

  useEffect(() => {
    setRow(undefined)
    sb.from('threads_reports').select('ngay,cap_nhat,data').eq('ngay', date).maybeSingle()
      .then(({ data, error }) => {
        if (!error) return setRow(data)
        // Bảng chưa tạo (chưa chạy supabase/012_threads.sql) thì báo nhẹ, không bật toast lỗi
        if (/threads_reports|schema cache|does not exist/i.test(error.message)) return setRow(false)
        notify(error.message, true); setRow(null)
      })
    // Lượt xem 7 ngày tới ngày đang xem
    sb.from('threads_reports').select('ngay,sl:data->tong->so_lieu').gte('ngay', addDays(date, -6)).lte('ngay', date)
      .then(({ data }) => {
        const by = Object.fromEntries((data || []).map((r) => [r.ngay, r.sl]))
        setTrend([6, 5, 4, 3, 2, 1, 0].map((k) => { const dd = addDays(date, -k); return { d: dd, v: by[dd]?.views ?? null } }))
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
  // Nick đã bỏ (bị khoá hẳn) chỉ nằm trong nick_song: xếp xuống cuối bảng, ghi mờ
  const dead = (d.nick_song || []).filter((k) => k.trang_thai_nick === 'bo' && !nicks.some((x) => x.ten === k.ten))
  const songChu = (k) => (!n(k.ngay_song) ? 'chưa đăng' : `${n(k.ngay_song)} ngày`)
  const stList = [...new Map(bai.map((b) => [b.trang_thai, b.trang_thai_chu || b.trang_thai])).entries()]
  const shown = bai
    .filter((b) => (!nick || b.nick === nick) && (!st || b.trang_thai === st))
    .sort((a, b) => sortBy === 'xem' ? n(b.so_lieu?.views) - n(a.so_lieu?.views) || tuongTac(b.so_lieu) - tuongTac(a.so_lieu)
      : String(a.luc_dang || a.gio_du_kien).localeCompare(String(b.luc_dang || b.gio_du_kien)))
  const sl = t.so_lieu
  const kpi = [['Đã đăng', t.da_dang], ['Còn chờ', t.cho], ['Lỗi', t.loi], ['Bình luận nhận', t.binh_luan_nhan], ['Đã trả lời', t.da_tra_loi]]

  return (
    <>
      {head}
      {d.tam_dung && <section className="card"><span className="chip bad">Tool đang tạm dừng</span> <span className="mini">Bài chờ sẽ chưa được đăng cho tới khi bật lại.</span></section>}

      <div className="kpis">
        {kpi.map(([l, v]) => <div key={l} className="kpi"><div className="lbl">{l}</div><div className="v" style={l === 'Lỗi' && n(v) ? { color: 'var(--red)' } : undefined}>{n(v)}</div></div>)}
      </div>

      <section className="card">
        <div className="card-h"><h2>Lượt xem và tương tác</h2><span className="count">{sl ? 'các bài đăng trong ngày' : 'chưa có số'}</span>
          {!sl && <div className="hint mini">Tool chưa lấy được số liệu. Nick nào chưa cấp quyền số liệu thì cần lấy lại mã, xong tool cập nhật mỗi giờ.</div>}
        </div>
        <div className="kpis th-kpis">
          {SO_LIEU.map(([k, l]) => <div key={k} className="kpi"><div className="lbl">{l}</div><div className="v">{fmt(sl?.[k])}</div></div>)}
        </div>
        <h3 className="th-h">Lượt xem 7 ngày</h3>
        <ViewsLine pts={trend} />
      </section>

      <section className="card">
        <div className="card-h"><h2>Theo nick</h2><span className="count">{nicks.length} nick</span></div>
        <div className="board-scroll">
          <table className="eff">
            <thead><tr><th>Nick</th><th>Ngày sống</th><th>Góc viết</th><th>Đã đăng</th><th>Còn chờ</th><th>Lỗi</th><th>Lượt xem</th><th>Tương tác</th><th>Người theo dõi</th><th>Tình trạng</th></tr></thead>
            <tbody>
              {nicks.map((k) => (
                <tr key={k.ten}>
                  <td><b>{k.ten}</b><div className="mini">{has(k.threads) ? <a href={`https://www.threads.com/@${k.threads}`} target="_blank" rel="noreferrer">@{k.threads}</a> : '-'}</div></td>
                  <td title={k.ngay_dau ? `Bài đầu ngày ${k.ngay_dau.split('-').reverse().join('/')}` : undefined}>
                    {songChu(k)}{k.trang_thai_nick === 'tam-dung' && <div><span className="chip bad">Đang bị khoá</span></div>}
                  </td>
                  <td>{[].concat(k.goc || []).join(', ') || '-'}</td>
                  <td>{n(k.da_dang)}</td>
                  <td>{n(k.cho)}</td>
                  <td style={n(k.loi) ? { color: 'var(--red)' } : undefined}>{n(k.loi)}</td>
                  {k.chua_quyen_so_lieu
                    ? <td colSpan={3}><span className="chip warn">Chưa cấp quyền số liệu</span></td>
                    : <><td>{fmt(k.so_lieu?.views)}</td><td>{fmt(tuongTac(k.so_lieu))}</td><td>{fmt(k.nguoi_theo_doi)}</td></>}
                  <td>{k.bi_dung ? <span className="chip bad">Bị dừng</span> : <span className="chip ok">Đang chạy</span>}</td>
                </tr>
              ))}
              {dead.map((k) => (
                <tr key={'bo-' + k.ten} style={{ opacity: 0.55 }}>
                  <td><b>{k.ten}</b><div className="mini">{has(k.threads) ? '@' + k.threads : '-'}</div></td>
                  <td>Chết sau {n(k.ngay_song)} ngày</td>
                  <td colSpan={7} className="mini">{k.ly_do || 'Nick đã bỏ'}{k.ngay_het ? ` · ngừng ngày ${k.ngay_het.split('-').reverse().join('/')}` : ''}</td>
                  <td><span className="chip">Đã bỏ</span></td>
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
            <select className="input" style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="gio">Xếp theo giờ đăng</option>
              <option value="xem">Xếp theo lượt xem</option>
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
                  {b.so_lieu && <span><b>{fmt(b.so_lieu.views)}</b> lượt xem · {fmt(b.so_lieu.likes)} thích · {fmt(b.so_lieu.replies)} trả lời{tuongTac(b.so_lieu) > n(b.so_lieu.likes) + n(b.so_lieu.replies) ? ` · ${fmt(tuongTac(b.so_lieu) - n(b.so_lieu.likes) - n(b.so_lieu.replies))} đăng lại/trích dẫn/chia sẻ` : ''}</span>}
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
