import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { useToast } from '../App.jsx'
import { ddmm, timeVN } from '../lib/date.js'

// Kết nối Muse (SQL 010): chỉ Thiện thấy. Tạo mã → mã hiện ĐÚNG 1 LẦN để Thiện tự dán vào Muse.
// DB chỉ lưu mã băm; tạo mã mới thì mã cũ ngừng chạy ngay. Không có mã nào in ra chat, file hay Telegram.
const FNS = [
  ['muse_them_bai_can_tra_loi', 'Bài cần trả lời'],
  ['muse_them_review', 'Review đề'],
  ['muse_them_lang_nghe', 'Lắng nghe'],
]
const when = (t) => (t ? `${ddmm(t.slice(0, 10))} ${timeVN(t)}` : '—')

async function copy(text, notify, what) {
  try { await navigator.clipboard.writeText(text); notify('Đã chép ' + what) } catch { notify('Không chép được, hãy bôi đen để chép', true) }
}

export default function MuseConnect({ me }) {
  const notify = useToast()
  const isOwner = !api.DEMO && (me.login_email || '').toLowerCase().startsWith('thienbk@')
  const [st, setSt] = useState(null)
  const [fresh, setFresh] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setSt(await api.museStatus()), [])
  useEffect(() => { if (isOwner) load() }, [isOwner, load])
  if (!isOwner || !st) return null
  const active = st.keys.find((k) => !k.revoked_at)

  async function create() {
    if (active && !confirm('Tạo mã mới thì mã đang dán trong Muse ngừng chạy ngay. Tạo nhé?')) return
    setBusy(true)
    try { setFresh(await api.museCreateKey()); await load() } catch (x) { notify(x.message, true) }
    setBusy(false)
  }
  async function revoke() {
    if (!confirm('Thu hồi mã: Muse sẽ không ghi lên dashboard được nữa cho tới khi tạo mã mới. Thu hồi nhé?')) return
    setBusy(true)
    try { await api.museRevoke(); setFresh(''); notify('Đã thu hồi mã Muse'); await load() } catch (x) { notify(x.message, true) }
    setBusy(false)
  }

  return (
    <section className="card muse">
      <div className="card-h"><h2>🤖 Kết nối Muse</h2><span className="count sub">chỉ bạn thấy mục này</span></div>
      <p className="mini" style={{ marginTop: 0 }}>
        Muse đọc group Facebook rồi tự ghi lên dashboard qua 3 địa chỉ dưới. Mỗi lần gọi: <b>POST</b>, body <code>{'{"items":[...]}'}</code>,
        2 header <code>apikey</code> và <code>x-muse-key</code>. Muse chỉ ghi được, không đọc, sửa hay xoá gì.
      </p>
      <div className="muse-rows">
        {FNS.map(([fn, label]) => (
          <div key={fn} className="muse-row"><span>{label}</span><code>{api.MUSE_BASE + fn}</code><button className="linkbtn" onClick={() => copy(api.MUSE_BASE + fn, notify, 'địa chỉ')}>Chép</button></div>
        ))}
        <div className="muse-row"><span>Header apikey</span><code>{api.MUSE_APIKEY.slice(0, 16)}…</code><button className="linkbtn" onClick={() => copy(api.MUSE_APIKEY, notify, 'apikey')}>Chép</button></div>
        <div className="muse-row"><span>Header x-muse-key</span><span>{active ? <>Đang dùng mã …{active.key_hint} · tạo {when(active.created_at)} · dùng gần nhất {when(active.last_used_at)}</> : <b className="sch-miss">Chưa có mã đang dùng</b>}</span></div>
      </div>
      {fresh && (
        <div className="muse-fresh">
          <b>Mã mới (chỉ hiện 1 lần, tải lại trang là mất):</b>
          <code>{fresh}</code>
          <div className="row">
            <button className="btn sm" onClick={() => copy(fresh, notify, 'mã')}>Chép mã</button>
            <button className="btn sm ghost" onClick={() => setFresh('')}>Đã dán vào Muse, ẩn mã</button>
          </div>
          <span className="mini">Dán mã vào Muse làm header x-muse-key. Đừng gửi mã qua chat, Zalo hay Telegram.</span>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" disabled={busy} onClick={create}>{active ? 'Tạo mã mới' : 'Tạo mã'}</button>
        {active && <button className="btn sm ghost" disabled={busy} onClick={revoke}>Thu hồi mã</button>}
      </div>
      {st.calls.length > 0 && (
        <details className="more">
          <summary>Muse gọi gần đây ({st.calls.length})</summary>
          {st.calls.map((c, i) => <div key={i} className="mini">{when(c.at)} · {c.fn} · {c.ok ? `thêm ${c.added}` : 'lỗi'}{c.note ? ` · ${c.note}` : ''}</div>)}
        </details>
      )}
    </section>
  )
}
