import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { sb, CONFIGURED, DEMO, getMe, signIn, signOut, changePassword } from './lib/api.js'
import { Mascot, Sheet, Tour, initials, store } from './components/ui.jsx'
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
    ;(as ? signIn(as, 'demo').catch(() => {}) : Promise.resolve())
      .then(() => sb.auth.getSession())
      .then(({ data }) => setSession(data.session))
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

const ADMIN_TABS = [
  { id: 'board', ic: '📊', label: 'Tổng quan' },
  { id: 'today', ic: '✅', label: 'Hôm nay' },
  { id: 'effect', ic: '📈', label: 'Hiệu quả' },
  { id: 'settings', ic: '⚙️', label: 'Cài đặt' },
]

function Shell({ me }) {
  const isAdmin = me.role === 'admin'
  const [tab, setTab] = useState(() => {
    const h = location.hash.slice(1)
    return isAdmin && ADMIN_TABS.some((t) => t.id === h) ? h : isAdmin ? 'board' : 'today'
  })
  const go = (t) => { setTab(t); history.replaceState(null, '', '#' + t); scrollTo({ top: 0 }) }
  const [menu, setMenu] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const tourKey = `kt_tour_${me.id}`
  // Bản demo chỉ hiện hướng dẫn khi có ?tour trên link (để chụp ảnh)
  const [tour, setTour] = useState(() => (DEMO ? new URLSearchParams(location.search).has('tour') : !store.get(tourKey)))
  const closeTour = () => { store.set(tourKey, '1'); setTour(false) }

  if (me.role === 'bot') {
    return (
      <div className="login"><div className="login-card">
        <div className="login-mascots"><Mascot who="tichtich" pose="sleeping" className="" /></div>
        <h1>Tài khoản bot</h1>
        <p className="sub">Tài khoản này dành cho lịch tự động, không dùng giao diện web.</p>
        <button className="btn block" onClick={signOut}>Đăng xuất</button>
      </div></div>
    )
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand"><span className="logo">KT</span><div>Đội nhóm Kỳ Tích<small>Aptis Kỳ Tích</small></div></div>
          {isAdmin && (
            <nav className="nav">
              {ADMIN_TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>{t.label}</button>)}
              <button disabled title="Sẽ làm sau">Khách (sắp có)</button>
            </nav>
          )}
          <div className="me">
            <button className="icon-btn" title="Hướng dẫn" onClick={() => setTour(true)}>?</button>
            <button className="avatar" title={me.name} onClick={() => setMenu((v) => !v)}>{initials(me.name)}</button>
          </div>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <div className="who"><b>{me.name}</b><div className="sub">{isAdmin ? 'Quản lý' : 'Thành viên'}</div></div>
              <button onClick={() => { setMenu(false); setTour(true) }}>📖 Xem hướng dẫn</button>
              <button onClick={() => { setMenu(false); setPwOpen(true) }}>🔑 Đổi mật khẩu</button>
              <button onClick={signOut}>↩︎ Đăng xuất</button>
            </div>
          )}
        </div>
      </header>

      <main className="wrap">
        {tab === 'today' && <Today me={me} hasNav={isAdmin} />}
        {tab === 'board' && isAdmin && <Board go={go} />}
        {tab === 'effect' && isAdmin && <Effect />}
        {tab === 'settings' && isAdmin && <Settings me={me} />}
      </main>

      {isAdmin && (
        <nav className="bottom-nav">
          {ADMIN_TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}><span className="ic">{t.ic}</span>{t.label}</button>)}
        </nav>
      )}

      {pwOpen && <PasswordSheet onClose={() => setPwOpen(false)} />}
      {tour && <Tour kind={isAdmin ? 'admin' : 'staff'} onClose={closeTour} />}
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
      <form className="login-card" onSubmit={submit}>
        <div className="login-mascots">
          <Mascot who="kyky" pose="waving" className="" />
          <Mascot who="tichtich" pose="cheer" className="" />
        </div>
        <h1>Đội nhóm Kỳ Tích</h1>
        <p className="sub">Bảng việc chung của team. Đăng nhập bằng tài khoản Thiện cấp.</p>
        <div className="field">
          <label>Tên đăng nhập</label>
          <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="vd: dag" required />
        </div>
        <div className="field">
          <label>Mật khẩu</label>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn block" disabled={busy}>{busy ? 'Đang vào…' : 'Vào làm việc →'}</button>
        {err && <div className="err">{err}</div>}
        <p className="sub" style={{ marginTop: 14, marginBottom: 0 }}>Quên mật khẩu? Nhắn Thiện cấp lại.</p>
      </form>
    </div>
  )
}

function PasswordSheet({ onClose }) {
  const notify = useToast()
  const [pw, setPw] = useState('')
  async function save(e) {
    e.preventDefault()
    if (pw.length < 8) return notify('Mật khẩu tối thiểu 8 ký tự', true)
    try { await changePassword(pw); notify('Đã đổi mật khẩu'); onClose() } catch (x) { notify(x.message, true) }
  }
  return (
    <Sheet onClose={onClose}>
      <form onSubmit={save}>
        <div className="sheet-h"><Mascot who="kyky" pose="search" className="" /><div><h2>Đổi mật khẩu</h2><div className="sub">Tối thiểu 8 ký tự, đừng dùng lại mật khẩu Facebook.</div></div></div>
        <input className="input" type="password" placeholder="Mật khẩu mới" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={onClose}>Huỷ</button>
          <button className="btn" style={{ flex: 1 }}>Lưu mật khẩu</button>
        </div>
      </form>
    </Sheet>
  )
}

function NoAccess({ email }) {
  return (
    <div className="login"><div className="login-card">
      <div className="login-mascots"><Mascot who="kyky" pose="sad" className="" /></div>
      <h1>Chưa được cấp quyền</h1>
      <p className="sub">Tài khoản <b>{email}</b> đăng nhập được nhưng chưa có trong danh sách thành viên (hoặc đã bị tắt). Nhắn Thiện thêm vào ở mục Cài đặt.</p>
      <button className="btn block" onClick={signOut}>Đăng xuất</button>
    </div></div>
  )
}

function NotConfigured() {
  return (
    <div className="login"><div className="login-card">
      <h1>Chưa kết nối Supabase</h1>
      <p className="sub">Tạo file <code>.env.local</code> theo mẫu <code>.env.example</code> rồi chạy lại <code>npm run dev</code>. Muốn xem thử giao diện: <code>npm run demo</code>.</p>
    </div></div>
  )
}
