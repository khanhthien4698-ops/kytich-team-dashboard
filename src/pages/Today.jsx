import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, longDate, timeVN, ddmm } from '../lib/date.js'
import { useToast } from '../App.jsx'
import Review from '../components/Review.jsx'
import { Mascot, Ring, Sheet, poseFor, greet, store, shortName } from '../components/ui.jsx'

export const KIND = { post: 'Bài đăng', comment: 'Comment vào bài người khác' }
export const KIND_SHORT = { post: 'Bài đăng', comment: 'Comment' }
const T_STATUS = { new: 'Mới', taken: 'Đã nhận', commented: 'Đã comment', skipped: 'Bỏ qua' }

// Đoán loại + group từ link Facebook
const groupKey = (u = '') => u.match(/groups\/([^/?#]+)/i)?.[1]?.toLowerCase()
export function detectLink(url, groups) {
  const kind = /[?&](reply_)?comment_id=|\/comment\//i.test(url) ? 'comment' : 'post'
  const k = groupKey(url)
  const group = k ? groups.find((g) => groupKey(g.url) === k) : null
  return { kind, group }
}

const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export default function Today({ me, hasNav }) {
  const notify = useToast()
  const isAdmin = me.role === 'admin'
  const [date, setDate] = useState(vnToday())
  const [members, setMembers] = useState([])
  const [whoId, setWhoId] = useState(me.id)
  const [d, setD] = useState(null)
  const [quick, setQuick] = useState(null) // { kind, ideaId, target }
  const [pickTab, setPickTab] = useState('comment')
  const [seenAt, setSeenAt] = useState('')
  const who = members.find((m) => m.id === whoId) || me

  const load = useCallback(async () => {
    const t = vnToday()
    const y = addDays(t, -1)
    setDate(t)
    try {
      const [ms, rs, day, ideas, gs, targets, yday, yrev, fb, hist] = await Promise.all([
        api.listMembers(), api.listRoutines(whoId), api.getDay(whoId, t), api.listIdeas(t), api.listGroups(),
        api.listActiveTargets(t), api.getDay(whoId, y), api.listReviewsSince(y), api.getFeedback(whoId, y),
        api.listPostsRange(addDays(t, -14), y),
      ])
      setMembers(ms)
      setD({
        routines: rs.filter((r) => r.active), day, ideas, groups: gs.filter((g) => g.active), targets,
        yday: { posts: yday.posts, reviewOf: Object.fromEntries(yrev.map((r) => [r.post_id, r])), fb },
        hist: hist.filter((p) => p.member_id === whoId),
      })
    } catch (x) { notify(x.message, true) }
  }, [whoId, notify])

  useEffect(() => { load() }, [load])
  // Bot quét group khoảng 3 tiếng/lần: để tab mở thì cứ 10 phút tự tải lại
  useEffect(() => {
    const i = setInterval(() => document.visibilityState === 'visible' && load(), 10 * 60 * 1000)
    return () => clearInterval(i)
  }, [load])
  const seenKey = `kt_tseen_${whoId}`
  useEffect(() => { setSeenAt(store.get(seenKey) || '') }, [seenKey])
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [load])

  const nameOf = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.name])), [members])
  if (!d) return <p className="empty">Đang tải…</p>
  const setDay = (fn) => setD((x) => ({ ...x, day: fn(x.day) }))

  // ---- Số liệu hôm nay ----
  const { routines, day, ideas, groups, targets, yday, hist } = d
  const checkOf = (rid) => day.checks.find((c) => c.routine_id === rid)
  const doneR = routines.filter((r) => checkOf(r.id)?.done).length + day.extras.filter((e) => e.done).length
  const totalR = routines.length + day.extras.length
  const nPost = day.posts.filter((p) => p.kind === 'post').length
  const nCmt = day.posts.filter((p) => p.kind === 'comment').length
  const qPost = who.seeding_quota ?? 0
  const qCmt = who.comment_quota ?? 0
  const units = totalR + qPost + qCmt
  const pct = units ? (doneR + Math.min(nPost, qPost) + Math.min(nCmt, qCmt)) / units : 0
  const streak = calcStreak(hist, qPost, qCmt, date, nPost >= qPost && nCmt >= qCmt)
  const fbKey = `kt_fb_${who.id}_${addDays(date, -1)}`
  const fbSeen = !!store.get(fbKey)

  async function toggle(r, patch) {
    const cur = checkOf(r.id)
    const row = { date, member_id: who.id, routine_id: r.id, done: cur?.done ?? false, note: cur?.note ?? null, ...patch }
    setDay((x) => ({ ...x, checks: [...x.checks.filter((c) => c.routine_id !== r.id), row] }))
    try { await api.saveCheck(row) } catch (x) { notify(x.message, true); load() }
  }
  async function take(t) {
    try { await api.takeTarget(t.id); notify('Đã nhận. Comment xong nhớ bấm "Đã comment" nhé!') } catch (x) { notify(x.message, true) }
    load()
  }

  // ---- Kỳ Kỳ gợi ý việc tiếp theo ----
  const next = []
  const myTaken = targets.filter((t) => t.status === 'taken' && t.taken_by === who.id)
  const openTargets = targets.filter((t) => t.status === 'new')
  const myOpen = openTargets.filter((t) => t.assigned_to === who.id)
  // Bài bot mới tìm thấy kể từ lần cuối bạn xem
  const freshT = openTargets.filter((t) => t.created_at > seenAt)
  const lastFound = freshT.reduce((m, t) => (t.created_at > m ? t.created_at : m), '')
  const seeFresh = () => {
    store.set(seenKey, lastFound); setSeenAt(lastFound)
    setPickTab('comment'); scrollToId('s2')
  }
  const myIdea = ideas.find((i) => i.taken_by === who.id && !day.posts.some((p) => p.idea_id === i.id))
  const freeIdeas = ideas.filter((i) => !i.taken_by)
  if (yday.fb && !fbSeen) next.push({ ic: '💬', t: 'Đọc góp ý của bot cho bài hôm qua', s: yday.fb.text.slice(0, 70) + (yday.fb.text.length > 70 ? '…' : ''), btn: 'Đọc', go: () => { store.set(fbKey, '1'); scrollToId('s1'); load() } })
  if (myTaken.length) next.push({ ic: '✍️', t: `Bạn đang giữ ${myTaken.length} bài chưa comment`, s: myTaken[0].question, btn: 'Đã comment', go: () => setQuick({ kind: 'comment', target: myTaken[0] }) })
  else if (nCmt < qCmt && openTargets.length) {
    const t = myOpen[0] || openTargets[0]
    next.push({ ic: '🎯', t: `Nhận 1 bài để comment (còn ${qCmt - nCmt} comment)`, s: t.question, btn: 'Nhận', go: () => take(t) })
  } else if (nCmt < qCmt) next.push({ ic: '💭', t: `Còn ${qCmt - nCmt} comment nữa`, s: 'Tìm bài hỏi về Aptis trong group, trả lời thật có ích rồi dán link', btn: 'Ghi', go: () => setQuick({ kind: 'comment' }) })
  if (nPost < qPost) {
    if (myIdea) next.push({ ic: '📝', t: `Viết bài từ thẻ “${myIdea.topic}”`, s: `Còn ${qPost - nPost} bài đăng`, btn: 'Ghi link', go: () => setQuick({ kind: 'post', ideaId: myIdea.id }) })
    else if (freeIdeas.length) next.push({ ic: '💡', t: `Lấy 1 thẻ gợi ý để viết bài (còn ${qPost - nPost} bài)`, s: `${freeIdeas.length} thẻ chưa ai lấy`, btn: 'Xem thẻ', go: () => scrollToId('s2') })
    else next.push({ ic: '📝', t: `Còn ${qPost - nPost} bài đăng nữa`, s: 'Đăng xong dán link vào là được', btn: 'Ghi', go: () => setQuick({ kind: 'post' }) })
  }
  const undone = routines.find((r) => !checkOf(r.id)?.done)
  if (undone) next.push({ ic: '☑️', t: undone.title, s: 'Việc cố định hằng ngày', btn: 'Xong', go: () => toggle(undone, { done: true }) })
  if (!day.note && pct >= 1) next.push({ ic: '🌙', t: 'Chốt ngày bằng 1 câu', s: 'Hôm nay làm được gì, vướng gì?', btn: 'Chốt', go: () => scrollToId('s4') })
  const first = next[0]
  const bubble = pct >= 1 && day.note ? 'Xong hết rồi! Hôm nay bạn làm tuyệt lắm 🎉'
    : first ? `Tiếp theo: ${first.t.charAt(0).toLowerCase() + first.t.slice(1)}.`
    : 'Mọi thứ đang ổn. Cố lên nhé!'

  return (
    <>
      {isAdmin && (
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="sub">Xem ngày của:</span>
          <select className="input" style={{ width: 'auto' }} value={whoId} onChange={(e) => { setD(null); setWhoId(e.target.value) }}>
            {members.filter((m) => m.active && m.role !== 'bot').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {/* ---- Đầu trang: Kỳ Kỳ + vòng tiến độ ---- */}
      <section className="hero">
        <div className="hero-top">
          <Mascot who="kyky" pose={poseFor(pct)} />
          <div>
            <div className="hero-hello">{greet()} · {longDate(date)}</div>
            <h1>{who.id === me.id ? shortName(who.name) : who.name} ơi, hôm nay xong {Math.round(pct * 100)}%</h1>
            <div className="bubble">{bubble}</div>
            {streak > 0 && <div className="streak">🔥 {streak} ngày liền đủ chỉ tiêu</div>}
          </div>
        </div>
        <div className="rings">
          <div className="ring-box"><Ring value={doneR} total={totalR} /><span className="lbl">Việc</span></div>
          <div className="ring-box"><Ring value={nPost} total={qPost} /><span className="lbl">Bài đăng</span></div>
          <div className="ring-box"><Ring value={nCmt} total={qCmt} /><span className="lbl">Comment</span></div>
        </div>
      </section>

      {freshT.length > 0 && (
        <section className="fresh">
          <span className="fresh-bell">🔔</span>
          <div className="fresh-txt">
            <b>Có {freshT.length} bài mới cần seeding</b>
            <span>Bot vừa tìm thấy lúc {timeVN(lastFound)}{freshT.some((t) => t.assigned_to === who.id) ? ` · ${freshT.filter((t) => t.assigned_to === who.id).length} bài giao cho bạn` : ''}. Vào nhận trước khi bài trôi nhé!</span>
          </div>
          <button className="btn sm" onClick={seeFresh}>Xem ngay</button>
        </section>
      )}

      <div className="grid2">
        {/* ---- Việc tiếp theo ---- */}
        <section className="card">
          <div className="card-h"><h2>⚡ Làm gì tiếp theo?</h2><span className="count sub">Kỳ Kỳ gợi ý</span></div>
          {next.length === 0 ? (
            <div className="all-done">
              <Mascot who="kyky" pose="trophy" className="" />
              <div><h3>Xong hết rồi!</h3><div className="sub">Đủ việc, đủ bài, đủ comment{day.note ? ', đã chốt ngày' : ''}. Nghỉ ngơi thôi.</div></div>
            </div>
          ) : (
            <div className="next">
              {next.slice(0, 4).map((n, i) => (
                <div key={i} className={'next-item' + (i === 0 ? ' first' : '')}>
                  <span className="next-ic">{n.ic}</span>
                  <div className="next-txt">{n.t}{n.s && <span className="sub">{n.s}</span>}</div>
                  <button className={'btn sm' + (i === 0 ? '' : ' ghost')} onClick={n.go}>{n.btn}</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <Feedback yday={yday} seen={fbSeen} onSeen={() => store.set(fbKey, '1')} />
      </div>

      <PickWork tab={pickTab} setTab={setPickTab} seenAt={seenAt} who={who} me={me} targets={targets} ideas={ideas} nameOf={nameOf} date={date} reload={load}
        onComment={(t) => setQuick({ kind: 'comment', target: t })} onWrite={(i) => setQuick({ kind: 'post', ideaId: i.id })} />

      <div className="grid2">
        <Tasks routines={routines} day={day} setDay={setDay} checkOf={checkOf} toggle={toggle} date={date} who={who} reload={load} doneR={doneR} totalR={totalR} />
        <SeedLog day={day} setDay={setDay} nPost={nPost} nCmt={nCmt} qPost={qPost} qCmt={qCmt} onAdd={() => setQuick({})} />
      </div>

      <DayNote date={date} who={who} note={day.note} setDay={setDay} ready={pct >= 1} />

      <button className={'fab' + (hasNav ? ' with-nav' : '')} onClick={() => setQuick({})}><span>+</span>Ghi seeding</button>
      {quick && (
        <QuickAdd preset={quick} who={who} date={date} groups={groups} ideas={ideas} onClose={() => setQuick(null)}
          onSaved={(row) => { if (row) setDay((x) => ({ ...x, posts: [...x.posts, row] })); setQuick(null); load() }} />
      )}
    </>
  )
}

// Số ngày liền đủ chỉ tiêu seeding (tính đến hôm qua, cộng hôm nay nếu đã đủ)
function calcStreak(hist, qPost, qCmt, today, todayFull) {
  if (!qPost && !qCmt) return 0
  let n = todayFull ? 1 : 0
  for (let k = 1; k <= 14; k++) {
    const dd = addDays(today, -k)
    const ps = hist.filter((p) => p.date === dd)
    if (ps.filter((p) => p.kind === 'post').length >= qPost && ps.filter((p) => p.kind === 'comment').length >= qCmt) n++
    else break
  }
  return n
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
      <StepHead no={1} done={seen || !fb} title="Góp ý hôm qua" right={avg && `★ ${avg}/5`} hint="Bot đọc bài & comment hôm qua của bạn và góp ý mỗi sáng." />
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
// Thẻ câu hỏi nguyên văn: nguồn/giờ/số lần lưu ở cột angle dạng "meta:{json}"
function ideaMeta(i) {
  if (!i.angle?.startsWith('meta:')) return null
  try { return JSON.parse(i.angle.slice(5)) } catch { return null }
}
function metaLine(m) {
  const src = m.src === 'web' ? '🤖 Web chatbot' : '💬 Zalo'
  const at = m.at ? (m.at.includes('T') ? timeVN(m.at) : m.at) : ''
  return [src, at, m.n > 1 ? `hỏi ${m.n} lần` : ''].filter(Boolean).join(' · ')
}

function PickWork({ tab, setTab, seenAt, who, me, targets, ideas, nameOf, date, reload, onComment, onWrite }) {
  const notify = useToast()
  const [busy, setBusy] = useState(null)
  // Bài còn mở nằm mãi trong danh sách (không hết hạn theo ngày) tới khi comment xong hoặc bị bỏ qua
  const openT = targets.filter((t) => t.status === 'new' || t.status === 'taken')
    .sort((a, b) => (b.status === 'taken' && b.taken_by === who.id) - (a.status === 'taken' && a.taken_by === who.id) || (b.created_at > a.created_at ? 1 : -1))
  const vnDate = (ts) => ts && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ts))
  const doneT = targets.filter((t) => t.status === 'commented' && (vnDate(t.taken_at) || t.date) === date)
  const skippedT = targets.filter((t) => t.status === 'skipped')
  const shownT = [...openT, ...doneT]
  const newT = openT.filter((t) => t.status === 'new').length
  const freeI = ideas.filter((i) => !i.taken_by).length
  const run = async (id, fn, ok) => {
    setBusy(id)
    try { await fn(); if (ok) notify(ok) } catch (x) { notify(x.message, true) }
    await reload(); setBusy(null)
  }
  const mine = (x) => x.taken_by === who.id
  const done = openT.every((t) => t.taken_by) && !ideas.some((i) => !i.taken_by && i.assigned_to === who.id)
  return (
    <section className="card" id="s2">
      <StepHead no={2} done={done && (shownT.length > 0 || ideas.length > 0)} title="Nhận việc" hint="Bấm “Mình nhận” / “Mình lấy” trước khi làm để không trùng với bạn khác." />
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'comment' ? 'on' : ''} onClick={() => setTab('comment')}>💬 Bài cần comment {newT > 0 && `(${newT})`}</button>
        <button className={tab === 'post' ? 'on' : ''} onClick={() => setTab('post')}>💡 Gợi ý bài đăng {freeI > 0 && `(${freeI})`}</button>
      </div>

      {tab === 'comment' && (
        <>
          {shownT.length === 0 && <div className="all-done"><Mascot who="kyky" pose="search" className="" /><div className="sub">Chưa có bài nào. Bot vào group khoảng 3 tiếng một lần (8h, 11h, 14h, 17h, 20h) lấy mọi bài mới để mình vào trả lời. Có bài mới sẽ hiện thông báo ở đầu trang.</div></div>}
          {shownT.length > 0 && <div className="list-count"><b>{newT}</b> bài chưa ai nhận · {openT.length - newT} đang làm · {doneT.length} đã comment hôm nay</div>}
          <div className="ideas two scroll-list">
            {shownT.map((t) => {
              const cls = t.status === 'commented' ? ' mine' : t.taken_by && !mine(t) ? ' taken' : ''
              return (
                <article key={t.id} className={'idea' + cls}>
                  <div className="idea-top"><span className="sub">{t.group_name} · {ddmm(t.date)}</span>{t.status === 'new' && t.created_at > seenAt && <span className="chip new">🔔 Vừa tìm</span>}<span className={'chip ' + (t.status === 'commented' ? 'ok' : t.status === 'new' ? '' : 'warn')}>{T_STATUS[t.status]}</span></div>
                  <div className="topic">{t.question}</div>
                  {t.angle && <div className="kv"><b>Gợi ý trả lời:</b> {t.angle}</div>}
                  {t.assigned_to && <div className="kv"><b>Giao cho:</b> {t.assigned_to === who.id ? 'bạn' : nameOf[t.assigned_to] || '—'}</div>}
                  <a href={t.url} target="_blank" rel="noreferrer" className="kv" style={{ fontWeight: 700 }}>Mở bài gốc ↗</a>
                  <div className="foot">
                    {t.status === 'new' && <>
                      <button className="btn sm" disabled={busy === t.id} onClick={() => run(t.id, () => api.takeTarget(t.id), 'Đã nhận')}>Mình nhận</button>
                      <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'skipped'), 'Đã chuyển vào mục Đã bỏ qua')}>Bỏ qua</button>
                    </>}
                    {t.status === 'taken' && mine(t) && <>
                      <button className="btn sm" onClick={() => onComment(t)}>Đã comment ✓</button>
                      <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, () => api.setTargetStatus(t.id, 'new'))}>Trả lại</button>
                    </>}
                    {t.status === 'taken' && !mine(t) && <span className="sub">{nameOf[t.taken_by] || 'Người khác'} đã nhận</span>}
                    {t.status === 'commented' && <span className="ok">✓ {t.taken_by === me.id ? 'Bạn' : nameOf[t.taken_by]} đã comment</span>}
                  </div>
                </article>
              )
            })}
          </div>
          {skippedT.length > 0 && (
            <details className="more skipped">
              <summary>Đã bỏ qua ({skippedT.length}) · xem lại</summary>
              {skippedT.map((t) => (
                <div key={t.id} className="skip-row">
                  <div className="skip-txt">
                    <div>{t.question}</div>
                    <span className="sub">{t.group_name} · {ddmm(t.date)} · <a href={t.url} target="_blank" rel="noreferrer">Mở bài gốc ↗</a></span>
                  </div>
                  <button className="btn sm ghost" disabled={busy === t.id} onClick={() => run(t.id, async () => { await api.setTargetStatus(t.id, 'new') }, 'Đã đưa lại vào danh sách')}>Đưa lại vào danh sách</button>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      {tab === 'post' && (
        <>
          {ideas.length === 0 && <div className="all-done"><Mascot who="kyky" pose="idea" className="" /><div className="sub">Chưa có thẻ gợi ý. Khoảng 8h–8h30 sáng bot gom câu học viên hỏi thật trên chatbot web và Zalo 24h qua.</div></div>}
          {ideas.some(ideaMeta) && <p className="mini ask-tip">Đây là câu học viên hỏi <b>nguyên văn</b>, để bạn biết người học hỏi thế nào. Viết bài trả lời từ nick/trang Kỳ Tích, không đăng lại như thể mình là người hỏi.</p>}
          {ideas.length > 0 && (
            <div className="itable">
              <div className="irow ihead"><span>Nội dung</span><span>Giao cho ai</span><span></span></div>
              {[...ideas].sort((a, b) => !!a.taken_by - !!b.taken_by).map((i) => {
                const m = ideaMeta(i)
                return (
                  <div key={i.id} className={'irow' + (i.taken_by ? ' got' : '') + (mine(i) ? ' me' : '')}>
                    <div className="icontent">
                      {m ? <>
                        <div className="iq">“{i.question}”</div>
                        <div className="imeta"><span className="chip">{i.topic}</span>{metaLine(m)}</div>
                      </> : <>
                        <div className="iq">{i.topic}</div>
                        <div className="imeta">{i.question}{i.angle && ` · Góc viết: ${i.angle}`}</div>
                      </>}
                    </div>
                    <div className="iwho">
                      {i.taken_by ? <span className="iwho-got">✓ {i.taken_by === who.id ? 'Bạn' : nameOf[i.taken_by] || 'Người khác'}</span>
                        : i.assigned_to ? <span className="sub">{i.assigned_to === who.id ? 'Bạn' : nameOf[i.assigned_to]} (chưa nhận)</span>
                        : <span className="sub">Chưa ai nhận</span>}
                    </div>
                    <div className="iact">
                      {!i.taken_by && <button className="btn sm" disabled={busy === i.id} onClick={() => run(i.id, () => api.takeIdea(i.id), 'Đã nhận')}>Nhận</button>}
                      {mine(i) && <>
                        <button className="btn sm" onClick={() => onWrite(i)}>Ghi link</button>
                        <button className="btn sm ghost" disabled={busy === i.id} onClick={() => run(i.id, () => api.releaseIdea(i.id))}>Trả lại</button>
                      </>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ---- Bước 3a: việc cố định + phát sinh ----
function Tasks({ routines, day, setDay, checkOf, toggle, date, who, reload, doneR, totalR }) {
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
      <StepHead no={3} done={totalR > 0 && doneR >= totalR} title="Việc trong ngày" right={`${doneR}/${totalR}`} hint="Bấm ô vuông khi xong. Có thể ghi chú ngắn dưới mỗi việc." />
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
      <form className="row" onSubmit={add} style={{ marginTop: 10 }}>
        <input className="input" placeholder="+ Thêm việc phát sinh" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn soft">Thêm</button>
      </form>
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
function SeedLog({ day, setDay, nPost, nCmt, qPost, qCmt, onAdd }) {
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
      <StepHead no={3} done={nPost >= qPost && nCmt >= qCmt} title="Seeding hôm nay" right={`${day.posts.length} link`} hint="Mỗi bài đăng / comment xong thì dán link vào đây." />
      <Bar label="Bài đăng" n={nPost} q={qPost} />
      <Bar label="Comment" n={nCmt} q={qCmt} />
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
          <button className="x" aria-label="Xoá" onClick={() => remove(p)}>×</button>
        </div>
      ))}
      <button className="btn ghost block" style={{ marginTop: 10 }} onClick={onAdd}>+ Ghi bài / comment</button>
    </section>
  )
}

// ---- Bước 4: chốt ngày ----
function DayNote({ date, who, note, setDay, ready }) {
  const notify = useToast()
  const [v, setV] = useState(note?.note || '')
  const [editing, setEditing] = useState(!note)
  useEffect(() => { setV(note?.note || ''); setEditing(!note) }, [note, who.id])
  async function save(e) {
    e.preventDefault()
    if (!v.trim()) return notify('Ghi 1 câu tổng kết ngày nhé', true)
    try {
      const row = await api.saveDayNote({ date, member_id: who.id, note: v.trim() })
      setDay((x) => ({ ...x, note: row })); setEditing(false); notify('Đã chốt ngày. Cảm ơn bạn!')
    } catch (x) { notify(x.message, true) }
  }
  return (
    <section className="card" id="s4">
      <StepHead no={4} done={!!note} title="Chốt ngày" hint={ready ? 'Đủ chỉ tiêu rồi, ghi 1 câu rồi nghỉ thôi!' : 'Cuối ngày ghi 1 câu: làm được gì, vướng gì. Thiện đọc ở Tổng quan.'} />
      {!editing ? (
        <div className="row"><Mascot who="kyky" pose="heart_wink" className="" /><div style={{ flex: 1 }}>{note.note}</div><button className="btn sm ghost" onClick={() => setEditing(true)}>Sửa</button></div>
      ) : (
        <form onSubmit={save}>
          <textarea className="input" placeholder="vd: Xong 5 comment, bài Speaking được nhiều bạn hỏi lại. Group B1B2 duyệt bài chậm." value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn block" style={{ marginTop: 10 }}>Chốt ngày</button>
        </form>
      )}
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
        notify('Đã ghi comment 🎉')
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
          <div><h2>{target ? 'Đã comment xong?' : 'Ghi seeding'}</h2><div className="sub">{target ? 'Dán link comment của bạn vào bài này' : 'Dán link, mình tự nhận ra loại và group'}</div></div>
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
                <label>Viết từ thẻ gợi ý nào <span className="sub">(tuỳ chọn)</span></label>
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
