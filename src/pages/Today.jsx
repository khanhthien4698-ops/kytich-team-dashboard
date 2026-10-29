import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, longDate, timeVN, addDays } from '../lib/date.js'
import Review from '../components/Review.jsx'
import { useToast } from '../App.jsx'

export const KIND = { post: 'Bài đăng', comment: 'Comment vào bài người khác' }
export const KIND_SHORT = { post: 'Bài đăng', comment: 'Comment' }

export default function Today({ me }) {
  const notify = useToast()
  const isAdmin = me.role === 'admin'
  const [date, setDate] = useState(vnToday())
  const [members, setMembers] = useState([])
  const [whoId, setWhoId] = useState(me.id)
  const who = members.find((m) => m.id === whoId) || me

  const [routines, setRoutines] = useState([])
  const [day, setDay] = useState(null)
  const [ideas, setIdeas] = useState([])
  const [groups, setGroups] = useState([])

  const load = useCallback(async () => {
    const d = vnToday()
    setDate(d)
    try {
      const [ms, rs, dd, is, gs] = await Promise.all([
        api.listMembers(), api.listRoutines(whoId), api.getDay(whoId, d), api.listIdeas(d), api.listGroups(),
      ])
      setMembers(ms); setRoutines(rs.filter((r) => r.active)); setDay(dd); setIdeas(is); setGroups(gs.filter((g) => g.active))
    } catch (x) { notify(x.message, true) }
  }, [whoId, notify])

  useEffect(() => { load() }, [load])
  // Quay lại tab là tải lại, để thấy thay đổi của người khác
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [load])

  const nameOf = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.name])), [members])
  if (!day) return <p className="empty">Đang tải…</p>

  const checkOf = (rid) => day.checks.find((c) => c.routine_id === rid)
  const doneRoutines = routines.filter((r) => checkOf(r.id)?.done).length
  const doneExtras = day.extras.filter((e) => e.done).length

  async function toggle(r, patch) {
    const cur = checkOf(r.id)
    const row = { date, member_id: who.id, routine_id: r.id, done: cur?.done ?? false, note: cur?.note ?? null, ...patch }
    setDay((d) => ({ ...d, checks: [...d.checks.filter((c) => c.routine_id !== r.id), row] }))
    try { await api.saveCheck(row) } catch (x) { notify(x.message, true); load() }
  }

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ marginRight: 'auto' }}>
          <h1>{who.id === me.id ? 'Hôm nay của tôi' : `Hôm nay của ${who.name}`}</h1>
          <div className="sub">{longDate(date)}</div>
        </div>
        {isAdmin && (
          <select className="input" style={{ width: 'auto' }} value={whoId} onChange={(e) => setWhoId(e.target.value)}>
            {members.filter((m) => m.active && m.role !== 'bot').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {day.report && (
        <div className="card" style={{ background: 'var(--orange-soft)' }}>
          <div className="card-h"><h2>Nhắc nhẹ từ bot sáng</h2></div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{day.report.text}</div>
        </div>
      )}

      <YesterdayFeedback who={who} today={date} />

      <div className="grid2">
        <div>
          <section className="card">
            <div className="card-h">
              <h2>Việc cố định</h2>
              <span className="count">{doneRoutines}/{routines.length}</span>
            </div>
            {routines.length === 0 && <p className="empty">Chưa có việc cố định. Thiện thêm ở Cài đặt.</p>}
            {routines.map((r) => {
              const c = checkOf(r.id)
              return (
                <div key={r.id} className={'task' + (c?.done ? ' done' : '')}>
                  <button className={'check' + (c?.done ? ' on' : '')} aria-label="Đánh dấu xong" onClick={() => toggle(r, { done: !c?.done })}>{c?.done ? '✓' : ''}</button>
                  <div className="task-body">
                    <div className="task-title">{r.title}</div>
                    {r.note && <div className="task-note">{r.note}</div>}
                    <NoteInput value={c?.note || ''} onSave={(note) => toggle(r, { note: note || null })} />
                  </div>
                </div>
              )
            })}
          </section>

          <Extras date={date} who={who} day={day} setDay={setDay} reload={load} doneExtras={doneExtras} />
        </div>

        <div>
          <Seeding date={date} who={who} day={day} setDay={setDay} groups={groups} ideas={ideas} />
        </div>
      </div>

      <Targets me={me} who={who} nameOf={nameOf} today={date} onCommented={load} />

      <Ideas ideas={ideas} me={me} nameOf={nameOf} reload={load} />

      <DayNote date={date} who={who} note={day.note} setDay={setDay} />
    </>
  )
}

function NoteInput({ value, onSave }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input className="note-input" placeholder="+ ghi chú" value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  )
}

function Extras({ date, who, day, setDay, reload, doneExtras }) {
  const notify = useToast()
  const [title, setTitle] = useState('')
  async function add(e) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const row = await api.addExtra({ date, member_id: who.id, title: title.trim() })
      setDay((d) => ({ ...d, extras: [...d.extras, row] })); setTitle('')
    } catch (x) { notify(x.message, true) }
  }
  async function toggle(t) {
    setDay((d) => ({ ...d, extras: d.extras.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }))
    try { await api.updateExtra(t.id, { done: !t.done }) } catch (x) { notify(x.message, true); reload() }
  }
  async function remove(t) {
    if (!confirm(`Xoá việc "${t.title}"?`)) return
    setDay((d) => ({ ...d, extras: d.extras.filter((x) => x.id !== t.id) }))
    try { await api.deleteExtra(t.id) } catch (x) { notify(x.message, true); reload() }
  }
  return (
    <section className="card">
      <div className="card-h">
        <h2>Việc phát sinh</h2>
        {day.extras.length > 0 && <span className="count">{doneExtras}/{day.extras.length}</span>}
      </div>
      {day.extras.map((t) => (
        <div key={t.id} className={'task' + (t.done ? ' done' : '')}>
          <button className={'check' + (t.done ? ' on' : '')} aria-label="Đánh dấu xong" onClick={() => toggle(t)}>{t.done ? '✓' : ''}</button>
          <div className="task-body"><div className="task-title">{t.title}</div></div>
          <button className="x" aria-label="Xoá" onClick={() => remove(t)}>×</button>
        </div>
      ))}
      <form className="row" onSubmit={add} style={{ marginTop: 8 }}>
        <input className="input" placeholder="+ Việc phát sinh" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn soft">Thêm</button>
      </form>
    </section>
  )
}

function Bar({ label, n, quota }) {
  const full = quota > 0 && n >= quota
  const pct = quota > 0 ? Math.min(100, (n / quota) * 100) : n ? 100 : 0
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="sub" style={{ color: 'var(--brown)', fontWeight: 600 }}>{label}</span>
        <b style={{ color: full ? 'var(--green)' : undefined, fontSize: 14 }}>{n}/{quota}{full ? ' ✓' : ''}</b>
      </div>
      <div className={'bar' + (full ? ' full' : '')}><span style={{ width: pct + '%' }} /></div>
    </div>
  )
}

function Seeding({ date, who, day, setDay, groups, ideas }) {
  const notify = useToast()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [groupId, setGroupId] = useState('')
  const [other, setOther] = useState('')
  const [kind, setKind] = useState('post')
  const [question, setQuestion] = useState('')
  const [ideaId, setIdeaId] = useState('')
  const [err, setErr] = useState('')
  const nPost = day.posts.filter((p) => p.kind === 'post').length
  const nCmt = day.posts.filter((p) => p.kind === 'comment').length
  const qPost = who.seeding_quota ?? 0
  const qCmt = who.comment_quota ?? 0
  const full = nPost >= qPost && nCmt >= qCmt
  const myIdeas = ideas.filter((i) => i.taken_by === who.id || i.assigned_to === who.id)

  async function save(e) {
    e.preventDefault()
    setErr('')
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) return setErr(kind === 'comment' ? 'Dán link comment (hoặc link bài gốc), bắt đầu bằng https://' : 'Dán link bài đăng (bắt đầu bằng https://).')
    const g = groups.find((x) => x.id === groupId)
    if (!g && !other.trim()) return setErr('Chọn group (hoặc ghi tên group khác).')
    try {
      const row = await api.addPost({ date, member_id: who.id, url: u, group_id: g?.id ?? null, group_name: g?.name ?? other.trim(), kind, question: kind === 'comment' ? question.trim() || null : null, idea_id: ideaId || null })
      setDay((d) => ({ ...d, posts: [...d.posts, row] }))
      setUrl(''); setOther(''); setIdeaId(''); setQuestion(''); setOpen(false)
      notify('Đã ghi ' + (kind === 'comment' ? 'comment' : 'bài đăng'))
    } catch (x) { setErr(x.message) }
  }
  async function remove(p) {
    if (!confirm('Xoá dòng seeding này?')) return
    setDay((d) => ({ ...d, posts: d.posts.filter((x) => x.id !== p.id) }))
    try { await api.deletePost(p.id) } catch (x) { notify(x.message, true) }
  }

  return (
    <section className="card">
      <div className="card-h">
        <h2>Seeding</h2>
        <span className="count" style={{ color: full ? 'var(--green)' : undefined }}>{full ? 'Đủ chỉ tiêu ✓' : ''}</span>
      </div>
      <Bar label="Bài đăng" n={nPost} quota={qPost} />
      <Bar label="Comment vào bài người khác" n={nCmt} quota={qCmt} />

      <div className="rule">
        Đăng công khai từ nick/trang Kỳ Tích (vd: “Tuần này nhiều bạn hỏi…, mình tổng hợp…”) hoặc trả lời câu hỏi thật trong group. <b>Không đóng vai học viên. Không chép nguyên văn tin nhắn Zalo của khách. Không dán link trơ trọi hay văn mẫu lặp lại.</b>
      </div>

      {!open ? (
        <button className="btn block" onClick={() => setOpen(true)}>+ Ghi bài seeding</button>
      ) : (
        <form className="form-box" onSubmit={save}>
          <div className="field">
            <label>Loại</label>
            <div className="seg">
              {Object.entries(KIND).map(([k, v]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{v}</button>)}
            </div>
          </div>
          <div className="field">
            <label>{kind === 'comment' ? 'Link comment' : 'Link bài đăng'} <span className="req">*</span></label>
            <input className="input" type="url" inputMode="url" placeholder="https://www.facebook.com/groups/…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            {kind === 'comment' && <div className="mini">Bấm vào giờ đăng của comment để lấy link. Không lấy được thì dán link bài gốc.</div>}
          </div>
          {kind === 'comment' && (
            <div className="field">
              <label>Bài gốc hỏi gì (tuỳ chọn)</label>
              <input className="input" placeholder="1 dòng, tự viết lại, không ghi tên người đăng" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} />
            </div>
          )}
          <div className="field">
            <label>Group <span className="req">*</span></label>
            <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— Chọn group —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="__other">Group khác…</option>
            </select>
            {groupId === '__other' && <input className="input" style={{ marginTop: 6 }} placeholder="Tên group" value={other} onChange={(e) => setOther(e.target.value)} />}
          </div>
          {kind === 'post' && (
            <div className="field">
              <label>Lấy từ gợi ý nào (nếu có)</label>
              <select className="input" value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
                <option value="">— Không —</option>
                {(myIdeas.length ? myIdeas : ideas).map((i) => <option key={i.id} value={i.id}>{i.topic}</option>)}
              </select>
            </div>
          )}
          {err && <div className="err">{err}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr('') }}>Huỷ</button>
            <button className="btn" style={{ flex: 1 }}>Lưu</button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 10 }}>
        {day.posts.length === 0 && <p className="empty">Hôm nay chưa ghi bài nào.</p>}
        {day.posts.map((p, i) => (
          <div key={p.id} className="post">
            <b>{i + 1}.</b>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
              <div className="meta"><span className={'pill' + (p.kind === 'comment' ? ' c' : '')}>{KIND_SHORT[p.kind]}</span> {p.group_name} · {p.created_at ? timeVN(p.created_at) : ''}</div>
              {p.question && <div className="meta">Bài gốc: {p.question}</div>}
            </div>
            <button className="x" aria-label="Xoá" onClick={() => remove(p)}>×</button>
          </div>
        ))}
      </div>
    </section>
  )
}

const T_STATUS = { new: 'Mới', taken: 'Đã nhận', commented: 'Đã comment', skipped: 'Bỏ qua' }

function Targets({ me, who, nameOf, today, onCommented }) {
  const notify = useToast()
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [linkFor, setLinkFor] = useState(null)
  const [link, setLink] = useState('')
  const load = useCallback(() => api.listTargets(addDays(today, -1), today).then(setList).catch((x) => notify(x.message, true)), [today, notify])
  useEffect(() => { load() }, [load])
  if (!list) return null
  // Bài mới/đang nhận còn trong 24h, và những bài đã xử lý hôm nay
  const shown = list.filter((t) => t.status === 'new' || t.status === 'taken' || t.date === today)
  const run = async (id, fn) => {
    setBusy(id)
    try { await fn() } catch (x) { notify(x.message, true) }
    await load(); setBusy(null)
  }
  async function done(t) {
    const u = link.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) return notify('Dán link comment (bắt đầu bằng https://)', true)
    await run(t.id, async () => { await api.completeTarget(t.id, u); setLinkFor(null); setLink(''); notify('Đã ghi comment vào seeding'); onCommented() })
  }
  const open = shown.filter((t) => t.status === 'new').length
  return (
    <section className="card">
      <div className="card-h"><h2>Cơ hội seeding</h2><span className="count">{open} bài chưa ai nhận</span></div>
      <p className="mini" style={{ marginTop: 0 }}>Bài của người khác trong group bot tìm lúc 17h, đáng vào comment trả lời. Nhận trước khi comment để không trùng người.</p>
      {shown.length === 0 && <p className="empty">Chưa có cơ hội nào. Bot sẽ tìm lúc 17h.</p>}
      <div className="ideas">
        {shown.map((t) => {
          const mine = t.taken_by === me.id
          const cls = t.status === 'commented' ? ' mine' : t.status === 'skipped' || (t.taken_by && !mine) ? ' taken' : ''
          return (
            <article key={t.id} className={'idea' + cls}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="sub">{t.group_name}</span>
                <span className={'tag ' + (t.status === 'commented' ? 'ok' : t.status === 'new' ? '' : 'warn')}>{T_STATUS[t.status]}</span>
              </div>
              <div className="topic">{t.question}</div>
              {t.angle && <div className="kv"><b>Góc trả lời:</b> {t.angle}</div>}
              {t.assigned_to && <div className="kv"><b>Giao cho:</b> {nameOf[t.assigned_to] || '—'}</div>}
              <a href={t.url} target="_blank" rel="noreferrer" className="kv">Mở bài gốc ↗</a>
              <div className="foot">
                {t.status === 'new' && <>
                  <button className="btn sm" disabled={busy === t.id} onClick={() => run(t.id, () => api.takeTarget(t.id))}>Mình nhận</button>
                  <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'skipped'))}>Bỏ qua</button>
                </>}
                {t.status === 'taken' && mine && linkFor !== t.id && <>
                  <button className="btn sm" onClick={() => { setLinkFor(t.id); setLink('') }}>Đã comment</button>
                  <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'new'))}>Trả lại</button>
                  <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'skipped'))}>Bỏ qua</button>
                </>}
                {t.status === 'taken' && !mine && <span className="sub">{nameOf[t.taken_by] || 'Người khác'} đã nhận</span>}
                {t.status === 'commented' && <span className="ok">✓ {t.taken_by === me.id ? 'Bạn' : nameOf[t.taken_by]} đã comment</span>}
                {t.status === 'skipped' && <span className="sub">Đã bỏ qua</span>}
              </div>
              {linkFor === t.id && (
                <div className="row" style={{ marginTop: 6 }}>
                  <input className="input" type="url" placeholder="Link comment của bạn" value={link} onChange={(e) => setLink(e.target.value)} autoFocus />
                  <button className="btn sm" disabled={busy === t.id} onClick={() => done(t)}>Lưu</button>
                  <button className="x" onClick={() => setLinkFor(null)} aria-label="Huỷ">×</button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Ideas({ ideas, me, nameOf, reload }) {
  const notify = useToast()
  const [busy, setBusy] = useState(null)
  async function take(i) {
    setBusy(i.id)
    try { await api.takeIdea(i.id); notify('Đã lấy thẻ') } catch (x) { notify(x.message, true) }
    await reload(); setBusy(null)
  }
  async function release(i) {
    setBusy(i.id)
    try { await api.releaseIdea(i.id) } catch (x) { notify(x.message, true) }
    await reload(); setBusy(null)
  }
  return (
    <section className="card">
      <div className="card-h"><h2>Gợi ý nội dung hôm nay</h2><span className="count">{ideas.length} thẻ</span></div>
      {ideas.length === 0 && <p className="empty">Chưa có gợi ý. Bot sáng sẽ đổ thẻ vào khoảng 8h.</p>}
      <div className="ideas">
        {ideas.map((i) => {
          const mine = i.taken_by === me.id
          return (
            <article key={i.id} className={'idea' + (mine ? ' mine' : i.taken_by ? ' taken' : '')}>
              <div className="topic">{i.topic}</div>
              {i.question && <div className="q">“{i.question}”</div>}
              {i.angle && <div className="kv"><b>Góc viết:</b> {i.angle}</div>}
              {i.gift_doc && <div className="kv"><b>Tặng:</b> {i.gift_doc}</div>}
              {i.assigned_to && <div className="kv"><b>Giao cho:</b> {nameOf[i.assigned_to] || '—'}</div>}
              <div className="foot">
                {!i.taken_by && <button className="btn sm" disabled={busy === i.id} onClick={() => take(i)}>Mình lấy</button>}
                {mine && <><span className="ok">✓ Bạn đã lấy</span><button className="btn sm ghost" disabled={busy === i.id} onClick={() => release(i)}>Trả lại</button></>}
                {i.taken_by && !mine && <span className="sub">{nameOf[i.taken_by] || 'Người khác'} đã lấy</span>}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function DayNote({ date, who, note, setDay }) {
  const notify = useToast()
  const [v, setV] = useState(note?.note || '')
  const [editing, setEditing] = useState(!note)
  useEffect(() => { setV(note?.note || ''); setEditing(!note) }, [note, who.id])
  async function save(e) {
    e.preventDefault()
    if (!v.trim()) return notify('Ghi 1 câu tổng kết ngày nhé', true)
    try {
      const row = await api.saveDayNote({ date, member_id: who.id, note: v.trim() })
      setDay((d) => ({ ...d, note: row })); setEditing(false); notify('Đã chốt ngày. Cảm ơn bạn!')
    } catch (x) { notify(x.message, true) }
  }
  return (
    <section className="card">
      <div className="card-h"><h2>Xong ngày</h2>{note && <span className="count ok">✓ Đã chốt</span>}</div>
      {!editing ? (
        <div className="row"><div style={{ flex: 1 }}>{note.note}</div><button className="btn sm ghost" onClick={() => setEditing(true)}>Sửa</button></div>
      ) : (
        <form onSubmit={save}>
          <textarea className="input" placeholder="1 câu: hôm nay làm được gì, vướng gì?" value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn block" style={{ marginTop: 8 }}>Xong ngày</button>
        </form>
      )}
    </section>
  )
}

function YesterdayFeedback({ who, today }) {
  const yday = addDays(today, -1)
  const [data, setData] = useState(null)
  useEffect(() => {
    let live = true
    Promise.all([api.getDay(who.id, yday), api.listReviewsSince(yday), api.getFeedback(who.id, yday)])
      .then(([d, reviews, fb]) => live && setData({ posts: d.posts, reviews, fb }))
      .catch(() => live && setData({ posts: [], reviews: [], fb: null }))
    return () => { live = false }
  }, [who.id, yday])
  if (!data || (!data.fb && data.posts.length === 0)) return null
  const reviewOf = (id) => data.reviews.find((r) => r.post_id === id)
  const scored = data.posts.map((p) => reviewOf(p.id)?.score).filter(Boolean)
  const avg = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1) : null
  return (
    <section className="card">
      <div className="card-h">
        <h2>Góp ý hôm qua</h2>
        {avg && <span className="count">★ {avg}/5</span>}
      </div>
      {data.fb ? <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{data.fb.text}</p> : <p className="empty">Bot chưa chấm bài hôm qua (thường xong lúc 8h sáng).</p>}
      {data.posts.length > 0 && (
        <details className="more">
          <summary>Xem góp ý từng bài ({data.posts.length})</summary>
        {data.posts.map((p, i) => (
          <div key={p.id} className="post">
            <b>{i + 1}.</b>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
              <div className="meta"><span className={'pill' + (p.kind === 'comment' ? ' c' : '')}>{KIND_SHORT[p.kind]}</span> {p.group_name}{p.question ? ' · Bài gốc: ' + p.question : ''}</div>
              <Review r={reviewOf(p.id)} kind={p.kind} />
            </div>
          </div>
        ))}
        </details>
      )}
    </section>
  )
}
