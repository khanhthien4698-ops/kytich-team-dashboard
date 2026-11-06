import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN, ddmm } from '../lib/date.js'
import { useToast } from '../App.jsx'
import Review from '../components/Review.jsx'
import { Mascot, Sheet, greet, store, shortName } from '../components/ui.jsx'

export const KIND = { post: 'Bài đăng', comment: 'Trả lời bài người khác' }
export const KIND_SHORT = { post: 'Bài đăng', comment: 'Trả lời' }
const T_STATUS = { new: 'Mới', taken: 'Đã nhận', commented: 'Đã trả lời', skipped: 'Bỏ qua' }

// Đoán loại + group từ link Facebook
const groupKey = (u = '') => u.match(/groups\/([^/?#]+)/i)?.[1]?.toLowerCase()
export function detectLink(url, groups) {
  const kind = /[?&](reply_)?comment_id=|\/comment\//i.test(url) ? 'comment' : 'post'
  const k = groupKey(url)
  const group = k ? groups.find((g) => groupKey(g.url) === k) : null
  return { kind, group }
}

const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

// Chỉ đăng bài seeding ở 2 group này (Thiện chốt 06/11)
export const POST_GROUPS = ['Key Aptis miễn phí - update liên tục', 'Hội review đề Aptis có tâm']
const vnDate = (ts) => ts && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ts))

export default function Today({ me, hasNav, viewId, onView }) {
  const notify = useToast()
  const isAdmin = me.role === 'admin'
  const [date, setDate] = useState(vnToday())
  const [members, setMembers] = useState([])
  const whoId = viewId || me.id
  const [d, setD] = useState(null)
  const [quick, setQuick] = useState(null) // { kind, ideaId, target }
  const [pickTab, setPickTab] = useState('post')
  const [seenAt, setSeenAt] = useState('')
  const who = members.find((m) => m.id === whoId) || me
  // Xem việc của người khác: chỉ xem, không bấm được (trừ admin)
  const readOnly = who.id !== me.id && !isAdmin

  const load = useCallback(async () => {
    const t = vnToday()
    const y = addDays(t, -1)
    setDate(t)
    try {
      const [ms, rs, day, pool, gs, targets, yday, yrev, fb, hist, teamPosts] = await Promise.all([
        api.listMembers(), api.listRoutines(whoId), api.getDay(whoId, t), api.listIdeaPool(t), api.listGroups(),
        api.listActiveTargets(t), api.getDay(whoId, y), api.listReviewsSince(y), api.getFeedback(whoId, y),
        api.listPostsRange(addDays(t, -14), y), api.listPostsRange(addDays(t, -7), t),
      ])
      setMembers(ms)
      setD({
        routines: rs.filter((r) => r.active), day, pool, groups: gs.filter((g) => g.active), targets, teamPosts,
        yday: { posts: yday.posts, reviewOf: Object.fromEntries(yrev.map((r) => [r.post_id, r])), fb },
        hist: hist.filter((p) => p.member_id === whoId),
      })
    } catch (x) { notify(x.message, true) }
  }, [whoId, notify])

  useEffect(() => { setD(null); load() }, [load])
  // Bot quét group khoảng 3 tiếng/lần: để tab mở thì cứ 5 phút tự tải lại
  useEffect(() => {
    const i = setInterval(() => document.visibilityState === 'visible' && load(), 5 * 60 * 1000)
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', f) }
  }, [load])
  const seenKey = `kt_tseen_${whoId}`
  useEffect(() => { setSeenAt(store.get(seenKey) || '') }, [seenKey])

  const nameOf = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.name])), [members])
  if (!d) return <p className="empty">Đang tải…</p>
  const setDay = (fn) => setD((x) => ({ ...x, day: fn(x.day) }))

  // ---- Số liệu hôm nay ----
  const { routines, day, pool, groups, targets, teamPosts, yday } = d
  const checkOf = (rid) => day.checks.find((c) => c.routine_id === rid)
  const doneR = routines.filter((r) => checkOf(r.id)?.done).length + day.extras.filter((e) => e.done).length
  const totalR = routines.length + day.extras.length
  const nPost = day.posts.filter((p) => p.kind === 'post').length
  const nCmt = day.posts.filter((p) => p.kind === 'comment').length
  const qPost = who.seeding_quota ?? 0
  const qCmt = who.comment_quota ?? 0
  const units = totalR + qPost + qCmt
  const pct = units ? (doneR + Math.min(nPost, qPost) + Math.min(nCmt, qCmt)) / units : 0
  const leftT = targets.filter((t) => (t.status === 'new' && t.assigned_to === who.id) || (t.status === 'taken' && t.taken_by === who.id)).length
  const yScores = yday.posts.map((p) => yday.reviewOf[p.id]?.score).filter(Boolean)
  const yAvg = yScores.length ? yScores.reduce((a, b) => a + b, 0) / yScores.length : null
  const fbKey = `kt_fb_${who.id}_${addDays(date, -1)}`
  const fbSeen = !!store.get(fbKey)

  async function toggle(r, patch) {
    if (readOnly) return
    const cur = checkOf(r.id)
    const row = { date, member_id: who.id, routine_id: r.id, done: cur?.done ?? false, note: cur?.note ?? null, ...patch }
    setDay((x) => ({ ...x, checks: [...x.checks.filter((c) => c.routine_id !== r.id), row] }))
    try { await api.saveCheck(row) } catch (x) { notify(x.message, true); load() }
  }

  // Bài bot mới tìm thấy kể từ lần cuối bạn xem
  const freshT = targets.filter((t) => t.status === 'new' && t.created_at > seenAt && t.assigned_to === who.id)
  const lastFound = freshT.reduce((m, t) => (t.created_at > m ? t.created_at : m), '')
  const seeFresh = () => {
    store.set(seenKey, lastFound); setSeenAt(lastFound)
    setPickTab('comment'); scrollToId('seeding')
  }
  const firstName = shortName(who.name)

  return (
    <>
      {/* ---- Đầu trang: 1 dòng tóm tắt ---- */}
      <section className="hero">
        <div className="hero-top">
          <div>
            <div className="hero-hello">{greet()} · {longDate(date)}{who.id !== me.id && ' · đang xem việc của ' + who.name}</div>
            <h1>{who.id === me.id ? `Chào ${firstName}, hôm nay bạn xong ${Math.round(pct * 100)}%` : `${who.name} hôm nay xong ${Math.round(pct * 100)}%`}</h1>
            <div className="bar hero-bar"><span style={{ width: Math.round(pct * 100) + '%' }} /></div>
            <div className="summary">
              <span>Đã đăng <b>{nPost}/{qPost}</b> bài</span>
              <span>Đã trả lời <b>{nCmt}/{qCmt}</b> bài</span>
              <span>Còn <b>{leftT}</b> bài cần trả lời</span>
              {yAvg && <span>Điểm bot hôm qua <b>★ {yAvg.toFixed(1).replace('.', ',')}</b></span>}
            </div>
          </div>
        </div>
      </section>

      {who.id !== me.id && <div className="viewing">Bạn đang xem việc của <b>{who.name}</b>{readOnly && ' (chỉ xem)'} · <button className="linkbtn" onClick={() => onView?.(null)}>Về việc của tôi</button></div>}

      {!readOnly && freshT.length > 0 && (
        <section className="fresh">
          <span className="fresh-bell">🔔</span>
          <div className="fresh-txt">
            <b>{freshT.length} bài mới giao cho bạn</b>
            <span>Bot vừa tìm thấy lúc {timeVN(lastFound)}. Vào nhận trước khi bài trôi nhé!</span>
          </div>
          <button className="btn sm" onClick={seeFresh}>Xem ngay</button>
        </section>
      )}

      <Seeding tab={pickTab} setTab={setPickTab} seenAt={seenAt} who={who} me={me} readOnly={readOnly} targets={targets} pool={pool}
        teamPosts={teamPosts} groups={groups} nameOf={nameOf} date={date} nPost={nPost} qPost={qPost} nCmt={nCmt} qCmt={qCmt} reload={load} />

      <div className="grid2">
        <Feedback yday={yday} seen={fbSeen} onSeen={() => store.set(fbKey, '1')} />
        <Tasks routines={routines} day={day} setDay={setDay} checkOf={checkOf} toggle={toggle} date={date} who={who} reload={load} doneR={doneR} totalR={totalR} readOnly={readOnly} />
      </div>

      <SeedLog day={day} setDay={setDay} nPost={nPost} nCmt={nCmt} qPost={qPost} qCmt={qCmt} onAdd={() => setQuick({})} readOnly={readOnly} />

      {!readOnly && <button className={'fab' + (hasNav ? ' with-nav' : '')} onClick={() => setQuick({})}><span>+</span>Thêm link</button>}
      {quick && (
        <QuickAdd preset={quick} who={who} date={date} groups={groups} ideas={pool.taken} onClose={() => setQuick(null)}
          onSaved={(row) => { if (row) setDay((x) => ({ ...x, posts: [...x.posts, row] })); setQuick(null); load() }} />
      )}
    </>
  )
}

function StepHead({ no, done, title, hint, right }) {
  return (
    <div className="card-h">
      <span className={'step-no' + (done ? ' done' : '')}>{done ? '✓' : no}</span>
      <h2>{title}</h2>
      {right && <span className="count">{right}</span>}
      {hint && <div className="hint sub">{hint}</div>}
    </div>
  )
}

// ---- Bước 1: góp ý của bot cho hôm qua ----
function Feedback({ yday, seen, onSeen }) {
  const { posts, reviewOf, fb } = yday
  const rv = posts.map((p) => reviewOf[p.id]).filter(Boolean)
  const scores = rv.map((r) => r.score).filter(Boolean)
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null
  const live = rv.filter((r) => r.status === 'live').length
  const bad = rv.filter((r) => r.status === 'removed' || r.status === 'hidden').length
  return (
    <section className="card" id="s1">
      <StepHead no={1} done={seen || !fb} title="Góp ý hôm qua" right={avg && `★ ${avg}/5`} hint="Mỗi sáng bot đọc bài đăng và bài trả lời hôm qua của bạn rồi góp ý." />
      {!fb && posts.length === 0 && (
        <div className="all-done"><Mascot who="kyky" pose="sleeping" className="" /><div className="sub">Hôm qua chưa có bài nào để chấm. Hôm nay mình làm thật tốt nhé!</div></div>
      )}
      {!fb && posts.length > 0 && <p className="empty">Bot chưa chấm xong (thường xong khoảng 8h–8h30 sáng).</p>}
      {fb && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Mascot who="kyky" pose={avg >= 4 ? 'cheer' : avg && avg < 3 ? 'thinking' : 'idea'} className="" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bubble" style={{ marginTop: 0, background: 'var(--cream)', boxShadow: 'none' }}>{fb.text}</div>
            {rv.length > 0 && <div className="detect"><span className="chip ok">{live}/{rv.length} còn sống</span>{bad > 0 && <span className="chip bad">{bad} bị gỡ/ẩn</span>}</div>}
          </div>
        </div>
      )}
      {posts.length > 0 && (
        <details className="more" onToggle={(e) => e.currentTarget.open && onSeen()}>
          <summary>Xem góp ý từng bài ({posts.length})</summary>
          {posts.map((p, i) => (
            <div key={p.id} className="post">
              <span className={'num' + (p.kind === 'comment' ? ' c' : '')}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a className="link" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
                <div className="meta"><span className={'chip' + (p.kind === 'comment' ? ' c' : '')}>{KIND_SHORT[p.kind]}</span>{p.group_name}{p.question && <span>· {p.question}</span>}</div>
                <Review r={reviewOf[p.id]} kind={p.kind} />
              </div>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

// ---- Bước 2: nhận việc (cơ hội comment + thẻ gợi ý bài đăng) ----
// Chữ dài: cắt còn N dòng, bấm để xem hết
function Clamp({ text, lines }) {
  const [open, setOpen] = useState(false)
  const long = text.length > lines * 60 || text.split('\n').length > lines
  return (
    <div>
      <div className={'clamp' + (open ? ' open' : '')} style={{ WebkitLineClamp: open ? 'unset' : lines }}>{text}</div>
      {long && <button type="button" className="linkbtn" onClick={() => setOpen((v) => !v)}>{open ? 'Thu gọn' : 'Xem hết'}</button>}
    </div>
  )
}

// Thẻ câu hỏi nguyên văn: nguồn/giờ/số lần/câu trả lời lưu ở cột angle dạng "meta:{json}"
function ideaMeta(i) {
  if (!i.angle?.startsWith('meta:')) return null
  try { return JSON.parse(i.angle.slice(5)) } catch { return null }
}
function Seeding({ tab, setTab, seenAt, who, me, readOnly, targets, pool, teamPosts, groups, nameOf, date, nPost, qPost, nCmt, qCmt, reload }) {
  const notify = useToast()
  const [busy, setBusy] = useState(null)
  const run = async (id, fn, ok) => {
    setBusy(id)
    try { await fn(); if (ok) notify(ok) } catch (x) { notify(x.message, true) }
    await reload(); setBusy(null)
  }
  const nm = (id) => (id === who.id ? (who.id === me.id ? 'Bạn' : shortName(who.name)) : shortName(nameOf[id] || 'Người khác'))

  // ---- Ý tưởng đăng bài ----
  const postOf = Object.fromEntries(teamPosts.filter((p) => p.idea_id).map((p) => [p.idea_id, p]))
  const doing = pool.taken.filter((i) => !postOf[i.id])
  const doneToday = pool.taken.filter((i) => postOf[i.id] && postOf[i.id].date === date)
  const ideaRows = [...doing.filter((i) => i.taken_by === who.id), ...pool.free, ...doing.filter((i) => i.taken_by !== who.id), ...doneToday]

  // ---- Bài cần trả lời ----
  const openT = targets.filter((t) => t.status === 'new' || t.status === 'taken')
    .sort((a, b) => rank(b) - rank(a) || (b.created_at > a.created_at ? 1 : -1))
  function rank(t) { return (t.taken_by === who.id ? 4 : 0) + (t.assigned_to === who.id ? 2 : 0) + (t.status === 'new' ? 1 : 0) }
  const doneT = targets.filter((t) => t.status === 'commented' && (vnDate(t.taken_at) || t.date) === date)
  const skippedT = targets.filter((t) => t.status === 'skipped')
  const myOpen = openT.filter((t) => (t.status === 'new' && t.assigned_to === who.id) || t.taken_by === who.id).length
  const take = (t) => {
    window.open(t.url, '_blank', 'noopener') // mở luôn bài gốc
    run(t.id, () => api.takeTarget(t.id), 'Đã nhận. Trả lời xong thì dán câu bạn đã comment vào ô bên dưới.')
  }

  return (
    <section className="card zone" id="seeding">
      <div className="card-h"><h2>Seeding</h2><span className="sub">Chỉ đăng ở Key Aptis miễn phí và Hội review đề Aptis có tâm</span></div>
      <div className="seg">
        <button className={tab === 'post' ? 'on' : ''} onClick={() => setTab('post')}>Ý tưởng đăng bài <span className="count">{pool.free.length}</span></button>
        <button className={tab === 'comment' ? 'on' : ''} onClick={() => setTab('comment')}>Bài cần trả lời {myOpen > 0 && <span className="count">{myOpen}</span>}</button>
      </div>

      {tab === 'post' && (
        <>
          <div className="list-count">{who.id === me.id ? 'Bạn' : shortName(who.name)} đã đăng <b>{nPost}/{qPost}</b> bài hôm nay. Câu hỏi và câu trả lời nguyên văn trong Zalo: viết bài từ trang Kỳ Tích, đừng đóng vai người hỏi.</div>
          {ideaRows.length === 0 && <div className="all-done"><Mascot who="kyky" pose="idea" className="" /><div className="sub">Kho ý tưởng đang trống. Bot nạp câu hỏi Zalo mỗi sáng khoảng 8h.</div></div>}
          {ideaRows.length > 0 && (
            <div className="itable">
              <div className="irow ihead"><span>Câu hỏi</span><span>Câu trả lời</span><span>Người đăng</span><span></span></div>
              {ideaRows.map((i) => {
                const ans = ideaMeta(i)?.ans || ''
                const post = postOf[i.id]
                const mineDoing = !post && i.taken_by === who.id
                return (
                  <div key={i.id} className={'irow' + (post ? ' got' : i.taken_by ? ' doing' : '')}>
                    <div className="icell iq" data-l="Câu hỏi"><Clamp text={i.question || i.topic} lines={4} /></div>
                    <div className="icell ians" data-l="Câu trả lời">{ans ? <Clamp text={ans} lines={4} /> : <span className="sub">—</span>}</div>
                    <div className="iwho">
                      {post ? <><span className="iwho-got">✓ {nm(i.taken_by)} đã đăng</span><a className="mini" href={post.url} target="_blank" rel="noreferrer">{post.group_name || 'xem bài'} ↗</a></>
                        : i.taken_by ? <span className="iwho-doing">● {nm(i.taken_by)} đang đăng</span>
                        : <span className="sub">Chưa ai lấy</span>}
                      {mineDoing && !readOnly && <PostLink idea={i} who={who} date={date} groups={groups} onDone={reload} />}
                    </div>
                    <div className="iact">
                      {!i.taken_by && !readOnly && <>
                        <button className="btn sm" disabled={busy === i.id} onClick={() => run(i.id, () => api.takeIdea(i.id), 'Đăng xong thì dán link vào ô bên dưới câu này.')}>Đăng câu này</button>
                        <button className="btn sm ghost" disabled={busy === i.id} onClick={() => run(i.id, () => api.skipIdea(i.id))}>Bỏ qua</button>
                      </>}
                      {mineDoing && !readOnly && <button className="linkbtn" disabled={busy === i.id} onClick={() => run(i.id, () => api.releaseIdea(i.id))}>Trả lại</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'comment' && (
        <>
          <div className="list-count">{who.id === me.id ? 'Bạn' : shortName(who.name)} đã trả lời <b>{nCmt}/{qCmt}</b> bài hôm nay · bot chia bài theo chỉ tiêu (An 5 · Châu 10)</div>
          {openT.length + doneT.length === 0 && <div className="all-done"><Mascot who="kyky" pose="search" className="" /><div className="sub">Chưa có bài nào. Bot vào group khoảng 3 tiếng một lần, có bài mới sẽ báo ở đầu trang.</div></div>}
          <div className="ideas two scroll-list">
            {[...openT, ...doneT].map((t) => {
              const mine = t.taken_by === who.id
              const forMe = t.assigned_to === who.id
              return (
                <article key={t.id} className={'idea tcard' + (t.status === 'commented' ? ' mine' : t.taken_by && !mine ? ' taken' : mine ? ' open' : '')}>
                  <div className="idea-top">
                    <span className="sub">{t.group_name} · {ddmm(t.date)}</span>
                    {t.assigned_to && <span className={'chip ' + (forMe ? 'mine' : '')}>{forMe ? (who.id === me.id ? 'Giao cho bạn' : 'Giao cho ' + shortName(who.name)) : 'Giao cho ' + shortName(nameOf[t.assigned_to] || '')}</span>}
                    {t.status === 'new' && t.created_at > seenAt && <span className="chip new">Mới</span>}
                    <span className={'chip ' + (t.status === 'commented' ? 'ok' : t.status === 'taken' ? 'warn' : '')}>{t.status === 'taken' ? nm(t.taken_by) + ' đã nhận' : T_STATUS[t.status]}</span>
                  </div>
                  <div className="tbody" title={t.question}>{t.question}</div>
                  {t.angle && <div className="kv"><b>Gợi ý trả lời:</b> {t.angle}</div>}
                  {t.status === 'taken' && mine && <a href={t.url} target="_blank" rel="noreferrer" className="kv topen">{t.url.replace(/^https?:\/\/(www\.)?/, '')} ↗</a>}
                  {t.status === 'commented' && (
                    <div className="said">✓ {nm(t.taken_by)} đã trả lời{t.comment_text && <>: <b>“{t.comment_text}”</b></>} · bot kiểm tra sáng mai</div>
                  )}
                  {!readOnly && (
                    <div className="foot">
                      {t.status === 'new' && <>
                        <button className={'btn sm' + (forMe || !t.assigned_to ? '' : ' ghost')} disabled={busy === t.id} onClick={() => take(t)}>{forMe || !t.assigned_to ? 'Nhận bài' : 'Nhận thay ' + shortName(nameOf[t.assigned_to] || '')}</button>
                        {(forMe || !t.assigned_to || me.role === 'admin') && <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'skipped'), 'Đã bỏ qua')}>Bỏ qua</button>}
                      </>}
                      {t.status === 'taken' && mine && <AnswerBox t={t} onDone={reload} />}
                      {t.status === 'taken' && !mine && <span className="sub">{nm(t.taken_by)} đang làm</span>}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {skippedT.length > 0 && (
            <details className="more skipped">
              <summary>Đã bỏ qua ({skippedT.length}) · xem lại</summary>
              {skippedT.map((t) => (
                <div key={t.id} className="skip-row">
                  <div className="skip-txt"><div>{t.question}</div><span className="sub">{t.group_name} · {ddmm(t.date)}</span></div>
                  {!readOnly && <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'new'), 'Đã đưa lại vào danh sách')}>Đưa lại vào danh sách</button>}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  )
}

// Dán link bài đã đăng ngay dưới câu ý tưởng (chỉ nhận 2 group được phép)
function PostLink({ idea, who, date, groups, onDone }) {
  const notify = useToast()
  const allowed = groups.filter((g) => POST_GROUPS.includes(g.name))
  const [url, setUrl] = useState('')
  const [gid, setGid] = useState('')
  const [busy, setBusy] = useState(false)
  const det = /^https?:\/\//i.test(url.trim()) ? detectLink(url.trim(), groups) : null
  async function save(e) {
    e.preventDefault()
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) return notify('Link chưa đúng. Dán link bắt đầu bằng https://', true)
    const g = det?.group || allowed.find((x) => x.id === gid)
    if (det?.group && !POST_GROUPS.includes(det.group.name)) return notify('Chỉ đăng ở Key Aptis miễn phí hoặc Hội review đề Aptis có tâm.', true)
    if (!g) return notify('Chọn group bạn đã đăng.', true)
    setBusy(true)
    try { await api.addPost({ date, member_id: who.id, url: u, group_id: g.id, group_name: g.name, kind: 'post', idea_id: idea.id }); notify('Đã ghi. Cảm ơn bạn!'); onDone() }
    catch (x) { notify(x.message, true); setBusy(false) }
  }
  return (
    <form className="pastebox" onSubmit={save}>
      <input className="input" placeholder="Dán link bài đã đăng" value={url} onChange={(e) => setUrl(e.target.value)} />
      {det && !det.group && (
        <select className="input" value={gid} onChange={(e) => setGid(e.target.value)}>
          <option value="">Đăng ở group nào?</option>
          {allowed.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      <button className="btn sm" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
    </form>
  )
}

// Trả lời xong: dán câu đã comment để bot kiểm tra
function AnswerBox({ t, onDone }) {
  const notify = useToast()
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    if (v.trim().length < 5) return notify('Dán câu bạn đã comment vào bài này.', true)
    setBusy(true)
    try { await api.answerTarget(t.id, v.trim()); notify('Đã ghi. Cảm ơn bạn!'); onDone() }
    catch (x) { notify(x.message, true); setBusy(false) }
  }
  return (
    <form className="cmtbox" onSubmit={save}>
      <textarea className="input" placeholder="Dán câu bạn đã comment vào bài này" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" className="linkbtn" onClick={() => api.setTargetStatus(t.id, 'new').then(onDone)}>Trả lại</button>
    </form>
  )
}

// ---- Bước 3a: việc cố định + phát sinh ----
function Tasks({ routines, day, setDay, checkOf, toggle, date, who, reload, doneR, totalR, readOnly }) {
  const notify = useToast()
  const [title, setTitle] = useState('')
  async function add(e) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const row = await api.addExtra({ date, member_id: who.id, title: title.trim() })
      setDay((x) => ({ ...x, extras: [...x.extras, row] })); setTitle('')
    } catch (x) { notify(x.message, true) }
  }
  async function toggleExtra(t) {
    setDay((x) => ({ ...x, extras: x.extras.map((e) => (e.id === t.id ? { ...e, done: !e.done } : e)) }))
    try { await api.updateExtra(t.id, { done: !t.done }) } catch (x) { notify(x.message, true); reload() }
  }
  async function removeExtra(t) {
    if (!confirm(`Xoá việc "${t.title}"?`)) return
    setDay((x) => ({ ...x, extras: x.extras.filter((e) => e.id !== t.id) }))
    try { await api.deleteExtra(t.id) } catch (x) { notify(x.message, true); reload() }
  }
  return (
    <section className="card" id="s3">
      <StepHead no={3} done={totalR > 0 && doneR >= totalR} title="Việc hằng ngày" right={`${doneR}/${totalR}`} hint="Xong việc nào thì tích việc đó. Có thể ghi chú ngắn." />
      {routines.length === 0 && day.extras.length === 0 && <p className="empty">Chưa có việc cố định. Thiện thêm ở Cài đặt.</p>}
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
      {day.extras.map((t) => (
        <div key={t.id} className={'task' + (t.done ? ' done' : '')}>
          <button className={'check' + (t.done ? ' on' : '')} aria-label="Đánh dấu xong" onClick={() => toggleExtra(t)}>{t.done ? '✓' : ''}</button>
          <div className="task-body"><div className="task-title">{t.title}</div><div className="task-note">Việc phát sinh</div></div>
          <button className="x" aria-label="Xoá" onClick={() => removeExtra(t)}>×</button>
        </div>
      ))}
      {!readOnly && (
        <form className="row" onSubmit={add} style={{ marginTop: 10 }}>
          <input className="input" placeholder="+ Thêm việc phát sinh" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn soft">Thêm</button>
        </form>
      )}
    </section>
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

// ---- Bước 3b: seeding đã ghi hôm nay ----
function SeedLog({ day, setDay, nPost, nCmt, qPost, qCmt, onAdd, readOnly }) {
  const notify = useToast()
  async function remove(p) {
    if (!confirm('Xoá dòng seeding này?')) return
    setDay((x) => ({ ...x, posts: x.posts.filter((y) => y.id !== p.id) }))
    try { await api.deletePost(p.id) } catch (x) { notify(x.message, true) }
  }
  const Bar = ({ label, n, q }) => (
    <div className="mbar" style={{ gridTemplateColumns: '78px 1fr 44px' }}>
      <span>{label}</span>
      <div className={'bar' + (q > 0 && n >= q ? ' full' : '')}><span style={{ width: (q ? Math.min(100, (n / q) * 100) : n ? 100 : 0) + '%' }} /></div>
      <span className="n" style={{ color: q > 0 && n >= q ? 'var(--green)' : undefined }}>{n}/{q}</span>
    </div>
  )
  return (
    <section className="card" id="s-log">
      <StepHead no={3} done={nPost >= qPost && nCmt >= qCmt} title="Bài đã làm hôm nay" right={`${day.posts.length} link`} hint="Mọi link bài đăng và bài trả lời trong ngày." />
      <Bar label="Bài đăng" n={nPost} q={qPost} />
      <Bar label="Bài trả lời" n={nCmt} q={qCmt} />
      <div className="rule">🚫 <b>Không đóng vai học viên.</b> Không chép nguyên tin nhắn Zalo của khách. Không dán link trơ trọi hay văn mẫu lặp lại. Đăng từ nick/trang Kỳ Tích hoặc trả lời câu hỏi thật.</div>
      {day.posts.length === 0 && <p className="empty">Chưa có link nào hôm nay.</p>}
      {day.posts.map((p, i) => (
        <div key={p.id} className="post">
          <span className={'num' + (p.kind === 'comment' ? ' c' : '')}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a className="link" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
            <div className="meta"><span className={'chip' + (p.kind === 'comment' ? ' c' : '')}>{KIND_SHORT[p.kind]}</span>{p.group_name}{p.created_at && <span>· {timeVN(p.created_at)}</span>}</div>
            {p.question && <div className="meta">Bài gốc: {p.question}</div>}
          </div>
          {!readOnly && <button className="x" aria-label="Xoá" onClick={() => remove(p)}>×</button>}
        </div>
      ))}
      {!readOnly && <button className="btn ghost block" style={{ marginTop: 10 }} onClick={onAdd}>+ Thêm link khác</button>}
    </section>
  )
}

// ---- Bảng ghi seeding nhanh: dán link là tự đoán loại + group ----
function QuickAdd({ preset, who, date, groups, ideas, onClose, onSaved }) {
  const notify = useToast()
  const target = preset.target
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState(preset.kind || 'post')
  const [groupId, setGroupId] = useState(target?.group_id || store.get('kt_last_group') || '')
  const [other, setOther] = useState('')
  const [question, setQuestion] = useState('')
  const [ideaId, setIdeaId] = useState(preset.ideaId || '')
  const [auto, setAuto] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  function onUrl(v) {
    setUrl(v)
    if (!/^https?:\/\//i.test(v.trim()) || target) return setAuto(null)
    const det = detectLink(v.trim(), groups)
    setAuto(det)
    if (!preset.kind) setKind(det.kind)
    if (det.group) setGroupId(det.group.id)
  }
  async function paste() {
    try { const t = await navigator.clipboard.readText(); onUrl(t.trim()) } catch { notify('Không đọc được clipboard, bạn dán tay nhé', true) }
  }
  async function save(e) {
    e.preventDefault()
    setErr('')
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) return setErr(kind === 'comment' ? 'Dán link comment (hoặc link bài gốc), bắt đầu bằng https://' : 'Dán link bài đăng, bắt đầu bằng https://')
    setBusy(true)
    try {
      if (target) {
        await api.completeTarget(target.id, u)
        notify('Đã ghi. Cảm ơn bạn!')
        return onSaved(null)
      }
      const g = groups.find((x) => x.id === groupId)
      if (!g && !other.trim()) { setBusy(false); return setErr('Chọn group (hoặc ghi tên group khác).') }
      if (g) store.set('kt_last_group', g.id)
      const row = await api.addPost({ date, member_id: who.id, url: u, group_id: g?.id ?? null, group_name: g?.name ?? other.trim(), kind, question: kind === 'comment' ? question.trim() || null : null, idea_id: kind === 'post' ? ideaId || null : null })
      notify(kind === 'comment' ? 'Đã ghi comment 🎉' : 'Đã ghi bài đăng 🎉')
      onSaved(row)
    } catch (x) { setErr(x.message); setBusy(false) }
  }
  const myIdeas = ideas.filter((i) => i.taken_by === who.id || i.assigned_to === who.id)

  return (
    <Sheet onClose={onClose}>
      <form onSubmit={save}>
        <div className="sheet-h">
          <Mascot who="kyky" pose={target ? 'checklist' : 'idea'} className="" />
          <div><h2>{target ? 'Đã trả lời xong?' : 'Thêm link'}</h2><div className="sub">{target ? 'Dán link bài trả lời của bạn' : 'Dán link, web tự nhận ra loại bài và group'}</div></div>
        </div>
        {target && <div className="form-box" style={{ marginTop: 0, marginBottom: 12 }}><b>{target.question}</b><div className="sub">{target.group_name}</div></div>}
        {!target && (
          <div className="seg" style={{ marginBottom: 12 }}>
            {Object.entries(KIND).map(([k, v]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{v}</button>)}
          </div>
        )}
        <div className="field">
          <label>{kind === 'comment' ? 'Link comment' : 'Link bài đăng'} <span className="req">*</span></label>
          <div className="row">
            <input className="input" type="url" inputMode="url" placeholder="https://www.facebook.com/groups/…" value={url} onChange={(e) => onUrl(e.target.value)} autoFocus />
            <button type="button" className="btn soft sm" style={{ minHeight: 46 }} onClick={paste}>Dán</button>
          </div>
          {kind === 'comment' && <div className="mini" style={{ marginTop: 4 }}>Bấm vào giờ đăng của comment để lấy link. Không lấy được thì dán link bài gốc.</div>}
          {auto && (
            <div className="detect">
              <span className="chip ok">✓ Nhận ra: {KIND_SHORT[auto.kind]}</span>
              {auto.group ? <span className="chip ok">✓ {auto.group.name}</span> : <span className="chip warn">Chưa nhận ra group, chọn bên dưới</span>}
            </div>
          )}
        </div>
        {!target && (
          <>
            <div className="field">
              <label>Group <span className="req">*</span></label>
              <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">— Chọn group —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="__other">Group khác…</option>
              </select>
              {groupId === '__other' && <input className="input" style={{ marginTop: 6 }} placeholder="Tên group" value={other} onChange={(e) => setOther(e.target.value)} />}
            </div>
            {kind === 'comment' && (
              <div className="field">
                <label>Bài gốc hỏi gì <span className="sub">(tuỳ chọn)</span></label>
                <input className="input" placeholder="1 dòng, tự viết lại, không ghi tên người đăng" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} />
              </div>
            )}
            {kind === 'post' && ideas.length > 0 && (
              <div className="field">
                <label>Viết từ ý tưởng nào <span className="sub">(tuỳ chọn)</span></label>
                <select className="input" value={ideaId} onChange={(e) => setIdeaId(e.target.value)}>
                  <option value="">— Không —</option>
                  {(myIdeas.length ? myIdeas : ideas).map((i) => <option key={i.id} value={i.id}>{i.topic}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost" onClick={onClose}>Huỷ</button>
          <button className="btn" style={{ flex: 1 }} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </form>
    </Sheet>
  )
}
