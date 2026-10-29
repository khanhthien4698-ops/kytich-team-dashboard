import { useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { vnToday, addDays, ddmm } from '../lib/date.js'
import { useToast } from '../App.jsx'
import { KIND } from './Today.jsx'
import Review, { interactions, isBad } from '../components/Review.jsx'

// Gom số liệu cho một nhóm bài (theo người hoặc theo group)
function summarize(posts, reviewOf) {
  const rv = posts.map((p) => reviewOf[p.id]).filter(Boolean)
  const scores = rv.map((r) => r.score).filter(Boolean)
  return {
    posts: posts.length,
    nPost: posts.filter((p) => p.kind === 'post').length,
    nCmt: posts.filter((p) => p.kind === 'comment').length,
    checked: rv.length,
    inter: rv.reduce((s, r) => s + interactions(r), 0),
    avg: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
    removed: rv.filter((r) => r.status === 'removed' || r.status === 'hidden').length,
    flagged: rv.filter((r) => r.rule_flags?.length > 0).length,
  }
}

function Table({ title, rows }) {
  return (
    <section className="card">
      <div className="card-h"><h2>{title}</h2></div>
      <div className="board-scroll">
        <table className="eff">
          <thead>
            <tr><th></th><th>Bài · Cmt</th><th>Đã chấm</th><th>Tương tác</th><th>TB/bài</th><th>Điểm TB</th><th>Gỡ/ẩn</th><th>Vi phạm</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="empty">Chưa có dữ liệu.</td></tr>}
            {rows.map(([name, s]) => (
              <tr key={name}>
                <td><b>{name}</b></td>
                <td>{s.nPost} · {s.nCmt}</td>
                <td>{s.checked}</td>
                <td>{s.inter}</td>
                <td>{s.checked ? (s.inter / s.checked).toFixed(1) : '—'}</td>
                <td>{s.avg ? '★ ' + s.avg.toFixed(1) : '—'}</td>
                <td style={{ color: s.removed ? 'var(--red)' : undefined }} title="Bị gỡ hoặc bị ẩn">{s.checked ? `${s.removed} (${Math.round((s.removed / s.checked) * 100)}%)` : '—'}</td>
                <td style={{ color: s.flagged ? 'var(--red)' : undefined }}>{s.flagged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Effect() {
  const notify = useToast()
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const today = vnToday()
  // Bài hôm nay chưa được chấm nên tính đến hôm qua
  const to = addDays(today, -1)
  const from = addDays(to, -(days - 1))

  useEffect(() => {
    Promise.all([api.listMembers(), api.listPostsRange(from, to), api.listReviewsSince(from), api.listTargets(from, to)])
      .then(([members, posts, reviews, targets]) => setData({ members, posts, targets, reviewOf: Object.fromEntries(reviews.map((r) => [r.post_id, r])) }))
      .catch((x) => notify(x.message, true))
  }, [from, to, notify])

  const switcher = (
    <div className="seg inline">
      {[7, 30].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} ngày</button>)}
    </div>
  )
  if (!data) return <><h1>Hiệu quả seeding</h1>{switcher}<p className="empty">Đang tải…</p></>

  const { members, posts, reviewOf, targets } = data
  const nameOf = Object.fromEntries(members.map((m) => [m.id, m.name]))
  const all = summarize(posts, reviewOf)
  const byPerson = members.filter((m) => m.role === 'staff').map((m) => [m.name, summarize(posts.filter((p) => p.member_id === m.id), reviewOf)])
  const groupNames = [...new Set(posts.map((p) => p.group_name || 'Không rõ'))]
  const byGroup = groupNames.map((g) => [g, summarize(posts.filter((p) => (p.group_name || 'Không rõ') === g), reviewOf)]).sort((a, b) => b[1].inter - a[1].inter)
  const top = posts
    .filter((p) => reviewOf[p.id] && !isBad(reviewOf[p.id]))
    .sort((a, b) => (reviewOf[b.id].score || 0) - (reviewOf[a.id].score || 0) || interactions(reviewOf[b.id]) - interactions(reviewOf[a.id]))
    .slice(0, 5)

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <h1>Hiệu quả seeding</h1>
          <div className="sub">{ddmm(from)} – {ddmm(to)} · theo kết quả bot chấm mỗi sáng</div>
        </div>
        {switcher}
      </div>

      <section className="card">
        <div className="stats">
          <div><div className="sub">Bài / đã chấm</div><h1>{all.posts} / {all.checked}</h1></div>
          <div><div className="sub">Tổng tương tác</div><h1>{all.inter}</h1></div>
          <div><div className="sub">Điểm TB · bị gỡ · vi phạm</div><h1>{all.avg ? '★' + all.avg.toFixed(1) : '—'} · {all.removed} · {all.flagged}</h1></div>
        </div>
      </section>

      <Table title="Theo người" rows={byPerson} />
      <Table title="Theo group" rows={byGroup} />

      <Targets targets={targets} members={members} />

      <section className="card">
        <div className="card-h"><h2>Top 5 bài tốt nhất</h2></div>
        {top.length === 0 && <p className="empty">Chưa có bài nào được chấm.</p>}
        {top.map((p, i) => (
          <div key={p.id} className="top-post">
            <div><b>{i + 1}. {nameOf[p.member_id]}</b> <span className="sub">· {ddmm(p.date)} · {p.group_name} · {KIND[p.kind]} · {interactions(reviewOf[p.id])} tương tác</span></div>
            <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
            <Review r={reviewOf[p.id]} kind={p.kind} />
          </div>
        ))}
      </section>
    </>
  )
}

// Cơ hội seeding bot tìm được: đã comment / bỏ qua / bỏ lỡ (còn mới hoặc nhận mà không comment)
function oppSum(list) {
  return {
    found: list.length,
    done: list.filter((t) => t.status === 'commented').length,
    skipped: list.filter((t) => t.status === 'skipped').length,
    missed: list.filter((t) => t.status === 'new' || t.status === 'taken').length,
  }
}

function Targets({ targets, members }) {
  const all = oppSum(targets)
  const owner = (t) => t.taken_by || t.assigned_to
  const byPerson = members.filter((m) => m.role === 'staff').map((m) => [m.name, oppSum(targets.filter((t) => owner(t) === m.id))])
  const none = targets.filter((t) => !owner(t))
  if (none.length) byPerson.push(['Chưa giao', oppSum(none)])
  const groups = [...new Set(targets.map((t) => t.group_name || 'Không rõ'))]
  const byGroup = groups.map((g) => [g, oppSum(targets.filter((t) => (t.group_name || 'Không rõ') === g))]).sort((a, b) => b[1].found - a[1].found)
  const T = ({ title, rows }) => (
    <div className="board-scroll" style={{ marginTop: 8 }}>
      <table className="eff" style={{ minWidth: 420 }}>
        <thead><tr><th>{title}</th><th>Tìm được</th><th>Đã comment</th><th>Bỏ qua</th><th>Bỏ lỡ</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="empty">Chưa có dữ liệu.</td></tr>}
          {rows.map(([k, s]) => (
            <tr key={k}><td><b>{k}</b></td><td>{s.found}</td><td>{s.done}</td><td>{s.skipped}</td><td style={{ color: s.missed ? 'var(--red)' : undefined }}>{s.missed}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <section className="card">
      <div className="card-h">
        <h2>Cơ hội seeding</h2>
        <span className="count">{all.done}/{all.found} đã comment · {all.missed} bỏ lỡ</span>
      </div>
      <p className="mini" style={{ marginTop: 0 }}>Bài của người khác bot tìm lúc 17h. Bỏ lỡ = tới hôm qua vẫn chưa ai comment (chưa nhận hoặc nhận mà chưa làm).</p>
      <T title="Theo người" rows={byPerson} />
      <T title="Theo group" rows={byGroup} />
    </section>
  )
}
