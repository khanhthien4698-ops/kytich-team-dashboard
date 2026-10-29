import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { useToast } from '../App.jsx'
import { Mascot } from '../components/ui.jsx'

const ROLE = { staff: 'Nhân viên', admin: 'Admin', bot: 'Bot' }

export default function Settings({ me }) {
  const notify = useToast()
  const [members, setMembers] = useState([])
  const [routines, setRoutines] = useState([])
  const [groups, setGroups] = useState([])
  const [who, setWho] = useState('')

  const load = useCallback(async () => {
    try {
      const [ms, rs, gs] = await Promise.all([api.listMembers(), api.listRoutines(), api.listGroups()])
      setMembers(ms); setRoutines(rs); setGroups(gs)
      setWho((w) => w || ms.find((m) => m.role === 'staff')?.id || '')
    } catch (x) { notify(x.message, true) }
  }, [notify])
  useEffect(() => { load() }, [load])

  async function save(fn, row, msg = 'Đã lưu') {
    try { await fn(row); notify(msg); await load() } catch (x) { notify(x.message, true) }
  }

  return (
    <>
      <div className="page-h">
        <Mascot who="tichtich" pose="checklist" className="" />
        <div><h1>Cài đặt</h1><div className="sub">Thành viên & chỉ tiêu, việc cố định từng người, danh sách group. Chỉ Thiện thấy trang này.</div></div>
      </div>

      <section className="card">
        <div className="card-h"><h2>👥 Thành viên & chỉ tiêu</h2></div>
        <p className="mini" style={{ marginTop: 0 }}>
          Email đăng nhập phải trùng với tài khoản tạo trong Supabase (Authentication → Users). Tên đăng nhập “dag” = email dag@{api.LOGIN_DOMAIN}. Chỉ tiêu: số bài đăng và số comment mỗi ngày. Không xoá người, chỉ tắt.
        </p>
        {members.map((m) => <MemberRow key={m.id} m={m} isSelf={m.id === me.id} onSave={(row) => save(api.saveMember, row)} />)}
        <MemberRow m={{ name: '', login_email: '', role: 'staff', seeding_quota: 2, comment_quota: 5, active: true, sort_order: members.length }} isNew onSave={(row) => save(api.saveMember, row, 'Đã thêm thành viên')} />
      </section>

      <section className="card">
        <div className="card-h">
          <h2>☑️ Việc cố định</h2>
          <select className="input" style={{ width: 'auto', marginLeft: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}>
            {members.filter((m) => m.role !== 'bot').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {routines.filter((r) => r.member_id === who).map((r) => <RoutineRow key={r.id} r={r} onSave={(row) => save(api.saveRoutine, row)} />)}
        {who && <RoutineRow key={'new' + who} r={{ member_id: who, title: '', note: '', active: true, sort_order: routines.filter((r) => r.member_id === who).length + 1 }} isNew onSave={(row) => save(api.saveRoutine, row, 'Đã thêm việc')} />}
      </section>

      <section className="card">
        <div className="card-h"><h2>📣 Group Facebook</h2><span className="count">{groups.filter((g) => g.active).length} đang dùng</span></div>
        {groups.map((g) => <GroupRow key={g.id} g={g} onSave={(row) => save(api.saveGroup, row)} />)}
        <GroupRow g={{ name: '', url: '', active: true, sort_order: groups.length }} isNew onSave={(row) => save(api.saveGroup, row, 'Đã thêm group')} />
      </section>
    </>
  )
}

function useDraft(init) {
  const [d, setD] = useState(init)
  const key = JSON.stringify(init)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setD(init), [key])
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const dirty = JSON.stringify(d) !== key
  return [d, set, dirty, setD]
}

function MemberRow({ m, isNew, isSelf, onSave }) {
  const [d, set, dirty, setD] = useDraft(m)
  function submit(e) {
    e.preventDefault()
    if (!d.name.trim()) return
    const login_email = d.login_email.trim().toLowerCase()
    onSave({ id: d.id, name: d.name.trim(), login_email: login_email ? api.toEmail(login_email) : null, role: d.role, seeding_quota: Number(d.seeding_quota) || 0, comment_quota: Number(d.comment_quota) || 0, active: d.active, sort_order: Number(d.sort_order) || 0 })
    if (isNew) setD(m)
  }
  return (
    <form className={'set-row m' + (d.active ? '' : ' off')} onSubmit={submit}>
      <input className="input" placeholder={isNew ? '+ Tên thành viên mới' : 'Tên'} value={d.name} onChange={set('name')} />
      <input className="input" placeholder="email hoặc tên đăng nhập" value={d.login_email || ''} onChange={set('login_email')} autoCapitalize="none" />
      <select className="input" value={d.role} onChange={set('role')} disabled={isSelf}>
        {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div className="row">
        <label className="toggle" title="Chỉ tiêu bài đăng mỗi ngày">
          <input className="input" type="number" min="0" max="50" style={{ width: 58, minHeight: 38 }} value={d.seeding_quota} onChange={set('seeding_quota')} /> bài
        </label>
        <label className="toggle" title="Chỉ tiêu comment vào bài người khác mỗi ngày">
          <input className="input" type="number" min="0" max="50" style={{ width: 58, minHeight: 38 }} value={d.comment_quota ?? 0} onChange={set('comment_quota')} /> cmt/ngày
        </label>
      </div>
      <div className="row">
        {!isNew && <label className="toggle"><input type="checkbox" checked={d.active} onChange={set('active')} disabled={isSelf} /> Đang làm</label>}
        <button className="btn sm" disabled={!dirty || !d.name.trim()}>{isNew ? 'Thêm' : 'Lưu'}</button>
      </div>
    </form>
  )
}

function RoutineRow({ r, isNew, onSave }) {
  const [d, set, dirty, setD] = useDraft(r)
  function submit(e) {
    e.preventDefault()
    if (!d.title.trim()) return
    onSave({ id: d.id, member_id: d.member_id, title: d.title.trim(), note: d.note?.trim() || null, active: d.active, sort_order: Number(d.sort_order) || 0 })
    if (isNew) setD(r)
  }
  return (
    <form className={'set-row r' + (d.active ? '' : ' off')} onSubmit={submit}>
      <input className="input" placeholder={isNew ? '+ Việc cố định mới' : 'Tên việc'} value={d.title} onChange={set('title')} />
      <input className="input" placeholder="Ghi chú / hướng dẫn (tuỳ chọn)" value={d.note || ''} onChange={set('note')} />
      <div className="row">
        {!isNew && <label className="toggle"><input type="checkbox" checked={d.active} onChange={set('active')} /> Bật</label>}
        <button className="btn sm" disabled={!dirty || !d.title.trim()}>{isNew ? 'Thêm' : 'Lưu'}</button>
      </div>
    </form>
  )
}

function GroupRow({ g, isNew, onSave }) {
  const [d, set, dirty, setD] = useDraft(g)
  function submit(e) {
    e.preventDefault()
    if (!d.name.trim()) return
    onSave({ id: d.id, name: d.name.trim(), url: d.url?.trim() || null, active: d.active, sort_order: Number(d.sort_order) || 0 })
    if (isNew) setD(g)
  }
  return (
    <form className={'set-row g' + (d.active ? '' : ' off')} onSubmit={submit}>
      <input className="input" placeholder={isNew ? '+ Tên group mới' : 'Tên group'} value={d.name} onChange={set('name')} />
      <input className="input" placeholder="Link group (để tự nhận ra group khi dán link)" value={d.url || ''} onChange={set('url')} />
      <div className="row">
        {!isNew && <label className="toggle"><input type="checkbox" checked={d.active} onChange={set('active')} /> Dùng</label>}
        <button className="btn sm" disabled={!dirty || !d.name.trim()}>{isNew ? 'Thêm' : 'Lưu'}</button>
      </div>
    </form>
  )
}
