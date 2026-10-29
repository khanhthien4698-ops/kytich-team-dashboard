import { useEffect, useState } from 'react'

// Linh vật Kỳ Tích: Kỳ Kỳ (nhân viên) và Tích Tích (admin). Ảnh trong public/mascot/.
export function Mascot({ who = 'kyky', pose = 'waving', className = 'mascot', alt = '' }) {
  return <img className={className} src={`${import.meta.env.BASE_URL}mascot/${who}-${pose}.svg`} alt={alt} draggable="false" />
}

// Chọn dáng linh vật theo tiến độ và giờ trong ngày
export function poseFor(pct, hour = new Date().getHours()) {
  if (pct >= 1) return 'trophy'
  if (pct >= 0.6) return 'cheer'
  if (pct > 0) return 'checklist'
  if (hour < 10) return 'coffee'
  if (hour >= 16) return 'thinking'
  return 'waving'
}

export function greet(hour = new Date().getHours()) {
  if (hour < 11) return 'Chào buổi sáng'
  if (hour < 14) return 'Chào buổi trưa'
  if (hour < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

export function Ring({ value, total, size = 64, stroke = 7, color = '#FEAD5F', track = 'rgba(255,255,255,.15)', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total > 0 ? Math.min(1, value / total) : value > 0 ? 1 : 0
  const done = total > 0 && value >= total
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={done ? '#3ddc84' : color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="val">{children ?? <>{value}<small>/{total}</small></>}</div>
    </div>
  )
}

// Tên gọi: chữ cuối của họ tên (Đinh Gia An → An); tên kiểu "Thành viên 1" giữ nguyên
export const shortName = (n = '') => { const w = n.trim().split(/\s+/); return /^\d+$/.test(w.at(-1)) ? n : w.at(-1) }

export const initials = (name = '') => name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()

export function Sheet({ onClose, children }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">{children}</div>
    </div>
  )
}

// localStorage an toàn (trình duyệt riêng tư có thể chặn)
export const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* bỏ qua */ } },
}

const TOURS = {
  staff: [
    { pose: 'waving', title: 'Chào bạn, mình là Kỳ Kỳ!', body: <p>Mỗi ngày mình sẽ chỉ cho bạn <b>việc tiếp theo nên làm</b>. Cứ nhìn bong bóng của mình ở đầu trang là biết.</p> },
    { pose: 'checklist', title: 'Một ngày gồm 4 bước', body: <ol><li><b>Đọc góp ý</b> bot chấm bài hôm qua</li><li><b>Nhận việc</b>: nhận bài cần comment, lấy thẻ gợi ý để viết bài</li><li><b>Làm & ghi lại</b>: tick việc, dán link bài / comment</li><li><b>Chốt ngày</b> bằng 1 câu</li></ol> },
    { pose: 'idea', title: 'Đăng xong là dán link', body: <p>Bấm nút <b>+ Ghi seeding</b> ở góc dưới, dán link. Mình tự nhận ra đó là <b>bài đăng hay comment</b> và <b>group nào</b>. Không đóng vai học viên, không chép tin nhắn khách nhé!</p> },
  ],
  admin: [
    { pose: 'waving', title: 'Chào Thiện, mình là Tích Tích!', body: <p>Trang <b>Tổng quan</b> cho Thiện biết ngay hôm nay team đang ra sao, ai cần nhắc, bài nào bị gỡ.</p> },
    { pose: 'search', title: 'Bấm vào từng ô ngày', body: <p>Mỗi bạn có 1 thẻ với dải 7 ngày: <b>xanh</b> đủ, <b>vàng</b> còn thiếu, <b>đỏ</b> chưa làm gì. Bấm 1 ô để xem việc, link seeding và điểm bot chấm.</p> },
    { pose: 'checklist', title: 'Hiệu quả & Cài đặt', body: <p><b>Hiệu quả</b>: điểm, tương tác, bài bị gỡ theo người và group. <b>Cài đặt</b>: chỉ tiêu, việc cố định, danh sách group Facebook.</p> },
  ],
}

export function Tour({ kind, onClose }) {
  const steps = TOURS[kind]
  const [i, setI] = useState(0)
  const s = steps[i]
  const who = kind === 'admin' ? 'tichtich' : 'kyky'
  return (
    <Sheet onClose={onClose}>
      <div className="tour">
        <Mascot who={who} pose={s.pose} className="" />
        <h2>{s.title}</h2>
        {s.body}
        <div className="dots">{steps.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="row">
          {i > 0 ? <button className="btn ghost" onClick={() => setI(i - 1)}>Quay lại</button> : <button className="btn ghost" onClick={onClose}>Bỏ qua</button>}
          <button className="btn" style={{ flex: 1 }} onClick={() => (i < steps.length - 1 ? setI(i + 1) : onClose())}>{i < steps.length - 1 ? 'Tiếp' : 'Bắt đầu thôi!'}</button>
        </div>
      </div>
    </Sheet>
  )
}
