import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN } from '../lib/date.js'
import { useToast } from '../App.jsx'

// Kho bài Threads EPIX (Thiện yêu cầu 25/11 qua phiên 21): người đăng chép bài, tải ảnh, đăng tay rồi bấm "Đã đăng".
// Nội dung: bảng threads_kho_bai (bot nạp bằng scripts/bot.mjs threads-kho). Đã đăng: bảng threads_kho_dang.
// Ảnh: bucket riêng tư threads-kho, xem qua link ký tạm 1 giờ.

const KPI = KPI_THREADS
const LOW = 30
const PAGE = 10
const SHOW_MAX = 50 // bảng luôn đầy tối đa 50 bài, đăng hoặc bỏ qua thì bài trong kho dự trữ tự lên thay (Thiện 25/11)
const BUCKET = 'threads-kho'
const LOAI = { meo: 'Mẹo', 'do-cau': 'Đố câu', 'tu-vung': 'Từ vựng', hoi: 'Hỏi', web: 'Giới thiệu web', 'hoi-dap': 'Hỏi', 'nhat-ky': 'Nhật ký', 'luyen-part': 'Luyện Part', 'chuan-dau-ra': 'Chuẩn đầu ra' }
const vnDate = (ts) => !ts ? vnToday() : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ts))
// Link bài Threads bắt buộc (Thiện chốt 25/11): threads.com hoặc threads.net, dạng /@nick/post/MÃ.
// Bỏ phần sau dấu ? và #, đưa về một dạng chuẩn để so trùng (cùng MÃ = cùng bài).
export const KPI_THREADS = 15
export function threadsLink(raw) {
  // Nhận cả khi dán kèm chữ khác, link có đuôi ?xmt=..., /media, chữ hoa ở tên miền
  const m = String(raw || '').trim().match(/threads\.(?:com|net)\/@([A-Za-z0-9._]{1,40})\/post\/([A-Za-z0-9_-]{5,40})(?![A-Za-z0-9_-])/i)
  return m ? `https://www.threads.com/@${m[1]}/post/${m[2]}` : null
}
const codeOf = (link) => (link || '').match(/\/post\/([A-Za-z0-9_-]+)$/)?.[1] || null
const LINK_SAI = 'Link chưa đúng. Trên Threads bấm Chia sẻ, chọn Sao chép liên kết rồi dán lại (dạng threads.com/@nick/post/...)'

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
      sb.from('threads_kho_bai').select('ma,ngay_goi_y,stt,loai,chu,binh_luan_dau,anh').order('ma').limit(2000),
      sb.from('threads_kho_dang').select('ma,member_id,luc,link').limit(5000),
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
  // Dòng không có link = bài đã bấm "Bỏ qua" (từ 25/11 "Đã đăng" luôn bắt buộc link)
  const posted = useMemo(() => dang.filter((x) => x.link && vnDate(x.luc) === date).sort((a, b) => a.luc.localeCompare(b.luc)), [dang, date])
  const skipped = useMemo(() => dang.filter((x) => !x.link && vnDate(x.luc) === date).sort((a, b) => b.luc.localeCompare(a.luc)), [dang, date])
  const baiOf = useMemo(() => Object.fromEntries((bai || []).map((x) => [x.ma, x])), [bai])
  const board = queue.slice(0, SHOW_MAX)
  const shown = board.slice(0, show)

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
  // Cùng 1 bài Threads không được ghi cho 2 bài trong kho
  const dupOf = (link, ma) => dang.find((p) => p.ma !== ma && codeOf(p.link) && codeOf(p.link) === codeOf(link))
  const dupMsg = (error) => /ma_bai_threads/i.test(error.message) ? 'Link này đã ghi cho bài khác trong kho' : /duplicate|unique/i.test(error.message) ? 'Bài này đã có người bấm đăng rồi' : /link_dang|check constraint/i.test(error.message) ? LINK_SAI : error.message
  const markDone = async (x) => {
    const link = threadsLink(links[x.ma])
    if (!link) return notify(LINK_SAI, true)
    const d = dupOf(link, x.ma)
    if (d) return notify(`Link này đã ghi cho bài ${d.ma}`, true)
    setBusy(x.ma)
    const { error } = await sb.from('threads_kho_dang').insert({ ma: x.ma, member_id: me.id, link })
    setBusy(null)
    if (error) return notify(dupMsg(error), true)
    setLinks((l) => { const c = { ...l }; delete c[x.ma]; return c })
    if (date !== today) setDate(today)
    notify('Đã ghi đăng bài ' + x.ma); load()
  }
  const skip = async (x) => {
    setBusy(x.ma)
    const { error } = await sb.from('threads_kho_dang').insert({ ma: x.ma, member_id: me.id })
    setBusy(null)
    if (error) return notify(dupMsg(error), true)
    if (date !== today) setDate(today)
    notify('Đã bỏ bài ' + x.ma + ' khỏi bảng'); load()
  }
  const undo = async (p) => {
    setBusy(p.ma)
    const { error } = await sb.from('threads_kho_dang').delete().eq('ma', p.ma)
    setBusy(null)
    if (error) return notify(error.message, true)
    notify('Bài đã về lại hàng chờ'); load()
  }
  const saveLink = async (p) => {
    const link = threadsLink(links[p.ma] ?? p.link)
    if (!link) return notify(LINK_SAI, true)
    const d = dupOf(link, p.ma)
    if (d) return notify(`Link này đã ghi cho bài ${d.ma}`, true)
    const { error } = await sb.from('threads_kho_dang').update({ link }).eq('ma', p.ma)
    if (error) return notify(dupMsg(error), true)
    setLinks((l) => { const c = { ...l }; delete c[p.ma]; return c })
    notify('Đã lưu link'); load()
  }
  const canEdit = (p) => p.member_id === me.id || me.role === 'admin'

  const head = (
    <div className="card-h">
      <h2>Kho bài EPIX</h2><span className="count">{bai ? `${Math.min(queue.length, SHOW_MAX)} bài trên bảng · kho còn ${Math.max(0, queue.length - SHOW_MAX)} bài dự trữ` : ''}</span>
    </div>
  )
  if (bai === undefined) return <section className="card">{head}<p className="empty">Đang tải...</p></section>
  if (bai === false) return <section className="card">{head}<p className="empty">Kho bài chưa có bảng dữ liệu. Chạy file supabase/015_threads_kho_bai.sql xong là dùng được.</p></section>
  if (bai === null) return <section className="card">{head}<p className="empty">Không tải được kho bài.</p></section>

  const counted = posted.filter((p) => threadsLink(p.link))
  const n = counted.length
  const noLink = posted.length - n
  const per = Object.entries(counted.reduce((o, p) => ({ ...o, [p.member_id]: (o[p.member_id] || 0) + 1 }), {}))

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
        {noLink > 0 && <div className="mini"><span className="chip warn">{noLink} bài chưa có link</span> chưa được tính, dán link ở mục bài đã đăng bên dưới.</div>}
        {per.length > 0 && <div className="mini">{per.map(([id, k]) => `${names[id] || '?'}: ${k} bài`).join(' · ')}</div>}
        {queue.length < LOW && <p className="kho-low"><span className="chip warn">Sắp hết bài</span> Hàng chờ còn {queue.length} bài, dưới {LOW}. Cần nạp thêm bài vào kho.</p>}
      </section>

      <section className="card">
        <details className="kho-hd" open={me.role !== 'admin'}>
          <summary><b>Hướng dẫn đăng</b> (đọc trước khi đăng)</summary>
          <p><b>Chỉ tiêu: 15 bài mỗi ngày</b>, đăng bằng nick Threads của Châu.</p>
          <ol>
            <li>Trước bài đầu tiên, thêm vào phần giới thiệu của hồ sơ: <b>Làm ở EPIX TOEIC</b>.</li>
            <li>Mỗi bài: chép chữ, tải đúng ảnh đi kèm rồi đăng. Đăng xong, dán link bài Threads vào ô bên dưới bài rồi bấm "Đã đăng". Phải có link thì bài mới được tính vào chỉ tiêu.</li>
            <li>Đăng rải từ sáng tới tối, mỗi bài cách nhau khoảng 45-60 phút. Đừng đăng dồn.</li>
            <li>Bài có "Bình luận đầu": đăng bài xong thì tự bình luận câu đó ngay, kèm ảnh bình luận (nút "Tải ảnh bình luận").</li>
            <li>Bài nào thấy không ổn thì bấm "Bỏ qua", bài đó rời bảng và bài khác trong kho tự lên thay.</li>
            <li>Ai comment thì trả lời bằng lời của Châu. Hỏi về EPIX mà không chắc thì hỏi Thiện, đừng đoán.</li>
            <li>Không dùng nick phụ hay nhờ nick ảo vào thích, comment bài của mình.</li>
            <li>Được sửa chữ cho hợp giọng Châu. Không thêm chuyện chưa xảy ra (điểm thi, đã đậu...).</li>
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
                {x.binh_luan_dau && <div className="th-reply"><b>{x.loai === 'do-cau' ? 'Đáp án (bình luận sau 2-3 tiếng):' : 'Bình luận đầu (tự bình luận ngay sau khi đăng):'}</b> {x.binh_luan_dau}</div>}
                <div className="kho-act">
                  <button className="btn ghost sm" onClick={() => copy(x.chu, 'bài')}>Chép bài</button>
                  {x.anh && <button className="btn ghost sm" onClick={() => download(x)}>Tải ảnh</button>}
                  {x.binh_luan_dau && <button className="btn ghost sm" onClick={() => copy(x.binh_luan_dau, x.loai === 'do-cau' ? 'đáp án' : 'bình luận')}>{x.loai === 'do-cau' ? 'Chép đáp án' : 'Chép bình luận'}</button>}
                  {x.binh_luan_dau && x.ma.startsWith('M-') && <button className="btn ghost sm" onClick={() => download({ anh: x.ma + '-bl.jpg' })}>Tải ảnh bình luận</button>}
                  <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={busy === x.ma} onClick={() => skip(x)}>Bỏ qua</button>
                </div>
                <div className="kho-done">
                  <input className="input" placeholder="Dán link bài Threads vừa đăng (bắt buộc)" value={links[x.ma] || ''} onChange={(e) => setLinks((l) => ({ ...l, [x.ma]: e.target.value }))} />
                  <button className="btn sm" disabled={busy === x.ma} onClick={() => markDone(x)}>Đã đăng</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {board.length > show && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShow(show + PAGE)}>Xem thêm {Math.min(PAGE, board.length - show)} bài</button>}
        {skipped.length > 0 && (
          <details className="kho-hd" style={{ marginTop: 12 }}>
            <summary>Đã bỏ qua {date === today ? 'hôm nay' : 'ngày này'}: {skipped.length} bài</summary>
            {skipped.map((p) => (
              <div key={p.ma} className="kho-done">
                <span className="mini" style={{ flex: 1 }}>{p.ma} · {(baiOf[p.ma]?.chu || '').slice(0, 80)}</span>
                {canEdit(p) && <button className="btn ghost sm" disabled={busy === p.ma} onClick={() => undo(p)}>Lấy lại</button>}
              </div>
            ))}
          </details>
        )}
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
                    <b>{timeVN(p.luc)}</b>{threadsLink(p.link) ? <span className="chip ok">Đã đăng</span> : <span className="chip warn">Chưa có link, chưa tính</span>}<b>{x.ma}</b>
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
