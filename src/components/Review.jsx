// Hiển thị kết quả bot chấm 1 bài seeding
export const STATUS = {
  live: { label: 'Còn sống', cls: 'ok' },
  removed: { label: 'Bị gỡ', cls: 'bad' },
  pending: { label: 'Chờ duyệt', cls: 'warn' },
  unreachable: { label: 'Không mở được', cls: 'warn' },
}
export const FLAGS = {
  dong_vai_hoc_vien: 'Đóng vai học viên',
  chep_tin_khach: 'Chép tin khách',
  spam_link: 'Spam link',
  sai_group: 'Sai group',
}

export const interactions = (r) => (r?.reactions ?? 0) + (r?.comments ?? 0) + (r?.shares ?? 0)
export const isBad = (r) => r && (r.status === 'removed' || r.rule_flags?.length > 0)

export function Stars({ score }) {
  if (!score) return null
  return <span className="stars" title={`${score}/5 điểm`}>{'★'.repeat(score)}<span className="dim">{'★'.repeat(5 - score)}</span></span>
}

export default function Review({ r }) {
  if (!r) return <div className="review none">Bot chưa chấm bài này.</div>
  const st = STATUS[r.status] || STATUS.unreachable
  const nums = [r.reactions != null && `${r.reactions} cảm xúc`, r.comments != null && `${r.comments} bình luận`, r.shares != null && `${r.shares} chia sẻ`].filter(Boolean)
  return (
    <div className={'review' + (isBad(r) ? ' bad' : '')}>
      <div className="review-h">
        <span className={'tag ' + st.cls}>{st.label}</span>
        <Stars score={r.score} />
        {nums.length > 0 && <span className="sub">{nums.join(' · ')}</span>}
      </div>
      {r.rule_flags?.length > 0 && <div className="flags">{r.rule_flags.map((f) => <span key={f} className="tag bad">⚠ {FLAGS[f] || f}</span>)}</div>}
      {r.good && <div><b className="k-good">Tốt:</b> {r.good}</div>}
      {r.improve && <div><b className="k-bad">Cần sửa:</b> {r.improve}</div>}
      {r.suggestion && <div><b className="k-sug">Gợi ý:</b> {r.suggestion}</div>}
    </div>
  )
}
