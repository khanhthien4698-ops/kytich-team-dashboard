import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { sb, CONFIGURED, DEMO, getMe, signIn, signOut, changePassword } from './lib/api.js'
import Today from './pages/Today.jsx'
import Board from './pages/Board.jsx'
import Settings from './pages/Settings.jsx'
import Effect from './pages/Effect.jsx'

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(undefined)
  const [toast, setToast] = useState(null)

  const notify = useCallback((msg, bad = false) => {
    setToast({ msg, bad })
    clearTimeout(notify.t)
    notify.t = setTimeout(() => setToast(null), 3200)
  }, [])

  useEffect(() => {
    if (!CONFIGURED) return
    // Bản demo: ?as=thanhvien1 để vào thẳng (phục vụ chụp ảnh)
    const as = DEMO && new URLSearchParams(location.search).get('as')
    if (as) signIn(as, 'demo')
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const email = session?.user?.email
  useEffect(() => {
    if (!email) { setMe(undefined); return }
    getMe(email).then(setMe).catch(() => setMe(null))
  }, [email])

  if (!CONFIGURED) return <NotConfigured />
  if (session === undefined) return null

  return (
    <ToastCtx.Provider value={notify}>
      {DEMO && <div className="demo-banner">BẢN DEMO — dữ liệu giả, không lưu</div>}
      {!session ? <Login /> : me === undefined ? null : !me ? <NoAccess email={email} /> : <Shell me={me} />}
      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')}>{toast.msg}</div>}
    </ToastCtx.Provider>
  )
}

function Shell({ me }) {
  const isAdmin = me.role === 'admin'
  const [tab, setTab] = useState(() => {
    const h = location.hash.slice(1)
    return isAdmin && ['board', 'effect', 'settings'].includes(h) ? h : isAdmin ? 'board' : 'today'
  })
  const go = (t) => { setTab(t); history.replaceState(null, '', '#' + t) }
  const [pwOpen, setPwOpen] = useState(false)

  if (me.role === 'bot') {
    return (
      <div className="login"><div className="card">
        <h2>Tài khoản bot</h2>
        <p className="sub">Tài khoản này dành cho lịch tự động, không dùng giao diện web.</p>
        <button className="btn block" onClick={signOut}>Đăng xuất</button>
      </div></div>
    )
  }

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="logo">KT</span>Đội nhóm Kỳ Tích</div>
        <div className="who">
          <span>{me.name}</span>
          <button onClick={() => setPwOpen((v) => !v)}>Mật khẩu</button>
          <button onClick={signOut}>Đăng xuất</button>
        </div>
      </header>
      <nav className="tabs">
        <button className={'tab' + (tab === 'today' ? ' on' : '')} onClick={() => go('today')}>Hôm nay của tôi</button>
        {isAdmin && <button className={'tab' + (tab === 'board' ? ' on' : '')} onClick={() => go('board')}>Bảng tổng</button>}
        {isAdmin && <button className={'tab' + (tab === 'effect' ? ' on' : '')} onClick={() => go('effect')}>Hiệu quả</button>}
        {isAdmin && <button className={'tab' + (tab === 'settings' ? ' on' : '')} onClick={() => go('settings')}>Cài đặt</button>}
        {isAdmin && <button className="tab" disabled title="Sẽ làm sau">Khách (sắp có)</button>}
      </nav>
      <main className="wrap">
        {pwOpen && <PasswordBox onDone={() => setPwOpen(false)} />}
        {tab === 'today' && <Today me={me} />}
        {tab === 'board' && isAdmin && <Board />}
        {tab === 'effect' && isAdmin && <Effect />}
        {tab === 'settings' && isAdmin && <Settings me={me} />}
      </main>
    </>
  )
}

function Login() {
  const [login, setLogin] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { await signIn(login, pw) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo-big">KT</div>
        <h1>Đội nhóm Kỳ Tích</h1>
        <p className="sub" style={{ marginBottom: 16 }}>Đăng nhập bằng tài khoản Thiện cấp.</p>
        <div className="field">
          <label>Tên đăng nhập hoặc email</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="vd: thanhvien1" required />
        </div>
        <div className="field">
          <label>Mật khẩu</label>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn block" disabled={busy}>{busy ? 'Đang vào…' : 'Đăng nhập'}</button>
        {err && <div className="err">{err}</div>}
        <p className="sub" style={{ marginTop: 14 }}>Quên mật khẩu? Nhắn Thiện cấp lại.</p>
      </form>
    </div>
  )
}

function PasswordBox({ onDone }) {
  const notify = useToast()
  const [pw, setPw] = useState('')
  async function save(e) {
    e.preventDefault()
    if (pw.length < 8) return notify('Mật khẩu tối thiểu 8 ký tự', true)
    try { await changePassword(pw); notify('Đã đổi mật khẩu'); onDone() } catch (x) { notify(x.message, true) }
  }
  return (
    <form className="card" onSubmit={save}>
      <div className="card-h"><h2>Đổi mật khẩu</h2></div>
      <div className="row">
        <input className="input" type="password" placeholder="Mật khẩu mới (≥ 8 ký tự)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button className="btn">Lưu</button>
      </div>
    </form>
  )
}

function NoAccess({ email }) {
  return (
    <div className="login"><div className="card">
      <h2>Chưa được cấp quyền</h2>
      <p className="sub">Tài khoản <b>{email}</b> đăng nhập được nhưng chưa có trong danh sách thành viên (hoặc đã bị tắt). Nhắn Thiện thêm vào ở mục Cài đặt.</p>
      <button className="btn block" onClick={signOut}>Đăng xuất</button>
    </div></div>
  )
}

function NotConfigured() {
  return (
    <div className="login"><div className="card">
      <h2>Chưa kết nối Supabase</h2>
      <p className="sub">Tạo file <code>.env.local</code> theo mẫu <code>.env.example</code> (VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY) rồi chạy lại <code>npm run dev</code>. Muốn xem thử giao diện: <code>npm run demo</code>.</p>
    </div></div>
  )
}
