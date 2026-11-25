import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'

// Kho bài Threads EPIX (Thiện yêu cầu 25/11 qua phiên 21): người đăng chép bài, tải ảnh, đăng tay rồi bấm "Đã đăng".
// Nội dung: bảng threads_kho_bai (bot nạp bằng scripts/bot.mjs threads-kho). Đã đăng: bảng threads_kho_dang.
// Ảnh: bucket riêng tư threads-kho, xem qua link ký tạm 1 giờ.

const KPI = 15
const LOW = 30
const PAGE = 10
const BUCKET = 'threads-kho'
const LOAI = { meo: 'Mẹo', 'do-cau': 'Đố câu', 'tu-vung': 'Từ vựng', hoi: 'Hỏi', web: 'Giới thiệu web' }
const vnDate = (ts) => !ts ? vnToday() : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ts))
const okLink = (s) => /^https?:\/\/\S+$/.test(s)

export default function KhoBai({ me }) {
  const notify = useToast()
  const today = vnToday()
  const [date, setDate] = useState(today)
  const [bai, setBai] = useState(undefined)
  const [dang, setDang] = useState([])
  const [names, setNames] = useState({})
  const [urls, setUrls] = useState({})
  const [links, setLinks] = useState({})
  const [show, setShow] = useState(PAGE)
  const [busy, setBusy] = useState(null)
  const asked = useRef(new Set())

  const load = useCallback(async () => {
    const [b, d, m] = await Promise.all([
      sb.from('threads_kho_bai').select('ma,ngay_goi_y,stt,loai,chu,binh_luan_dau,anh').order('ma'),
      sb.from('threads_kho_dang').select('ma,member_id,luc,link'),
      sb.from('members').select('id,name'),
    ])
    if (b.error) {
      if (/threads_kho_bai|schema cache|does not exist/i.test(b.error.message)) return setBai(false)
      notify(b.error.message, true); return setBai(null)
    }
    setBai(b.data || [])
    setDang(d.data || [])
    setNames(Object.fromEntries((m.data || []).map((x) => [x.id, x.name])))
  }, [notify])
  useEffect(() => { load() }, [load])

  const byMa = useMemo(() => Object.fromEntries(dang.map((x) => [x.ma, x])), [dang])
  const queue = useMemo(() => (bai || []).filter((x) => !byMa[x.ma]), [bai, byMa])
  const posted = useMemo(() => dang.filter((x) => vnDate(x.luc) === date).sort((a, b) => a.luc.localeCompare(b.luc)), [dang, date])
  const baiOf = useMemo(() => Object.fromEntries((bai || []).map((x) => [x.ma, x])), [bai])
  const shown = queue.slice(0, show)

  // Link ký tạm cho ảnh đang hiện (hàng chờ + đã đăng ngày đang xem)
  useEffect(() => {
    const need = [...shown, ...posted.map((p) => baiOf[p.ma]).filter(Boolean)].map((x) => x.anh).filter((p) => p && !asked.current.has(p))
    if (!need.length || !sb.storage) return
    need.forEach((p) => asked.current.add(p))
    sb.storage.from(BUCKET).createSignedUrls([...new Set(need)], 3600).then(({ data }) => {
      if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])) }))
    })
  }, [shown, posted, baiOf])

  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => notify('Đã chép ' + what), () => notify('Không chép được', true))
  const download = async (x) => {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(x.anh, 600, { download: x.anh })
    if (error || !data?.signedUrl) return notify('Không tải được ảnh', true)
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = x.anh; document.body.appendChild(a); a.click(); a.remove()
  }
  const markDone = async (x) => {
    const link = (links[x.ma] || '').trim()
    if (link && !okLink(link)) return notify('Link phải bắt đầu bằng http:// hoặc https://', true)
    setBusy(x.ma)
    const { error } = await sb.from('threads_kho_dang').insert({ ma: x.ma, member_id: me.id, link: link || null })
    setBusy(null)
    if (error) return notify(/duplicate|unique/i.test(error.message) ? 'Bài này đã có người bấm đăng rồi' : error.message, true)
    if (date !== today) setDate(today)
    notify('Đã ghi đăng bài ' + x.ma); load()
  }
  const undo = async (p) => {
    setBusy(p.ma)
    const { error } = await sb.from('threads_kho_dang').delete().eq('ma', p.ma)
    setBusy(null)
    if (error) return notify(error.message, true)
    notify('Đã bỏ tích, bài về lại hàng chờ'); load()
  }
  const saveLink = async (p) => {
    const link = (links[p.ma] ?? '').trim()
    if (link && !okLink(link)) return notify('Link phải bắt đầu bằng http:// hoặc https://', true)
    const { error } = await sb.from('threads_kho_dang').update({ link: link || null }).eq('ma', p.ma)
    if (error) return notify(error.message, true)
    notify('Đã lưu link'); load()
  }
  const canEdit = (p) => p.member_id === me.id || me.role === 'admin'

  const head = (
    <div className="card-h">
      <h2>Kho bài EPIX</h2><span className="count">{bai ? `${queue.length} bài chờ đăng` : ''}</span>
    </div>
  )
  if (bai === undefined) return <section className="card">{head}<p className="empty">Đang tải...</p></section>
  if (bai === false) return <section className="card">{head}<p className="empty">Kho bài chưa có bảng dữ liệu. Chạy file supabase/015_threads_kho_bai.sql xong là dùng được.</p></section>
  if (bai === null) return <section className="card">{head}<p className="empty">Không tải được kho bài.</p></section>

  const n = posted.length
  const per = Object.entries(posted.reduce((o, p) => ({ ...o, [p.member_id]: (o[p.member_id] || 0) + 1 }), {}))

  return (
    <>
      <section className="card">
        <div className="card-h">
          <h2>{date === today ? 'Hôm nay đã đăng' : 'Đã đăng ngày ' + longDate(date)}</h2>
          <div className="seg inline hint">
            <button onClick={() => setDate(addDays(date, -1))}>‹ Hôm trước</button>
            <button className={date === today ? 'on' : ''} onClick={() => setDate(today)}>Hôm nay</button>
            <button disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>Hôm sau ›</button>
          </div>
        </div>
        <div className="kho-kpi"><b>{n}</b>/{KPI} bài{n >= KPI && <span className="chip ok">Đủ chỉ tiêu</span>}</div>
        <div className={'bar' + (n >= KPI ? ' full' : '')}><span style={{ width: Math.min(100, Math.round((n / KPI) * 100)) + '%' }} /></div>
        {per.length > 0 && <div className="mini">{per.map(([id, k]) => `${names[id] || '?'}: ${k} bài`).join(' · ')}</div>}
        {queue.length < LOW && <p className="kho-low"><span className="chip warn">Sắp hết bài</span> Hàng chờ còn {queue.length} bài, dưới {LOW}. Cần nạp thêm bài vào kho.</p>}
      </section>

      <section className="card">
        <details className="kho-hd" open={me.role !== 'admin'}>
          <summary><b>Hướng dẫn đăng</b> (đọc trước khi đăng)</summary>
          <p><b>Chỉ tiêu: 15 bài mỗi ngày</b>, đăng bằng nick Threads của Châu.</p>
          <ol>
            <li>Trước bài đầu tiên, thêm vào phần giới thiệu của hồ sơ: <b>Làm ở EPIX TOEIC</b>.</li>
            <li>Mỗi bài: chép chữ, tải đúng ảnh đi kèm, đăng, rồi bấm "Đã đăng" ở đây (dán link bài nếu được).</li>
            <li>Đăng rải từ sáng tới tối, mỗi bài cách nhau khoảng 45-60 phút. Đừng đăng dồn.</li>
            <li>Bài đố câu: 2-3 tiếng sau mới đăng bình luận đáp án.</li>
            <li>Ai comment thì trả lời bằng lời của Châu. Hỏi về EPIX mà không chắc thì hỏi Thiện, đừng đoán.</li>
            <li>Không dùng nick phụ hay nhờ nick ảo vào thích, comment bài của mình.</li>
            <li>Được sửa chữ cho hợp giọng Châu, nhưng giữ câu "mình làm ở EPIX TOEIC" ở bài giới thiệu web. Không thêm chuyện chưa xảy ra (điểm thi, đã đậu...).</li>
            <li>Thấy Threads cảnh báo, hạn chế nick hoặc lượt xem tụt hẳn thì dừng và báo Thiện.</li>
          </ol>
        </details>
      </section>

      <section className="card">
        {head}
        {queue.length === 0 && <p className="empty">Hết bài chờ đăng. Bài mới nạp vào kho sẽ hiện ở đây.</p>}
        <div className="th-list">
          {shown.map((x) => (
            <div key={x.ma} className="th-item kho-item">
              {x.anh && (urls[x.anh] ? <a href={urls[x.anh]} target="_blank" rel="noreferrer"><img className="kho-img" src={urls[x.anh]} alt={'Ảnh bài ' + x.ma} loading="lazy" /></a> : <div className="kho-img ph" />)}
              <div className="kho-body">
                <div className="th-top">
                  <b>{x.ma}</b>
                  {x.loai && <span className="chip">{LOAI[x.loai] || x.loai}</span>}
                  {x.ngay_goi_y && x.ngay_goi_y < today && <span className="chip warn">Tồn từ {x.ngay_goi_y.slice(8)}/{x.ngay_goi_y.slice(5, 7)}</span>}
                </div>
                <div className="th-text open kho-chu">{x.chu}</div>
                {x.binh_luan_dau && <div className="th-reply"><b>Đáp án (bình luận sau 2-3 tiếng):</b> {x.binh_luan_dau}</div>}
                <div className="kho-act">
                  <button className="btn ghost sm" onClick={() => copy(x.chu, 'bài')}>Chép bài</button>
                  {x.anh && <button className="btn ghost sm" onClick={() => download(x)}>Tải ảnh</button>}
                  {x.binh_luan_dau && <button className="btn ghost sm" onClick={() => copy(x.binh_luan_dau, 'đáp án')}>Chép đáp án</button>}
                </div>
                <div className="kho-done">
                  <input className="input" placeholder="Dán link bài đã đăng (không bắt buộc)" value={links[x.ma] || ''} onChange={(e) => setLinks((l) => ({ ...l, [x.ma]: e.target.value }))} />
                  <button className="btn sm" disabled={busy === x.ma} onClick={() => markDone(x)}>Đã đăng</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {queue.length > show && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShow(show + PAGE)}>Xem thêm {Math.min(PAGE, queue.length - show)} bài</button>}
      </section>

      <section className="card">
        <div className="card-h"><h2>{date === today ? 'Bài đã đăng hôm nay' : 'Bài đã đăng ngày ' + longDate(date)}</h2><span className="count">{n}</span></div>
        {n === 0 && <p className="empty">Chưa có bài nào được bấm "Đã đăng" trong ngày này.</p>}
        <div className="th-list">
          {posted.map((p) => {
            const x = baiOf[p.ma] || { ma: p.ma, chu: '' }
            return (
              <div key={p.ma} className="th-item kho-item">
                {x.anh && urls[x.anh] && <img className="kho-img sm" src={urls[x.anh]} alt={'Ảnh bài ' + x.ma} loading="lazy" />}
                <div className="kho-body">
                  <div className="th-top">
                    <b>{timeVN(p.luc)}</b><span className="chip ok">Đã đăng</span><b>{x.ma}</b>
                    <span className="mini">{names[p.member_id] || '?'}</span>
                    {p.link && <a style={{ marginLeft: 'auto' }} href={p.link} target="_blank" rel="noreferrer">Mở bài ↗</a>}
                  </div>
                  <div className="th-text">{x.chu}</div>
                  {canEdit(p) && (
                    <div className="kho-done">
                      <input className="input" placeholder="Link bài trên Threads" value={links[p.ma] ?? p.link ?? ''} onChange={(e) => setLinks((l) => ({ ...l, [p.ma]: e.target.value }))} />
                      <button className="btn ghost sm" onClick={() => saveLink(p)}>Lưu link</button>
                      <button className="btn ghost sm" disabled={busy === p.ma} onClick={() => undo(p)}>Bỏ tích</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
