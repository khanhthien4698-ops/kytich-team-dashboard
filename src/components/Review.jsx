// Hiển thị kết quả bot chấm 1 bài seeding
export const STATUS = {
  live: { label: 'Còn sống', cls: 'ok' },
  hidden: { label: 'Bị ẩn', cls: 'bad' },
  removed: { label: 'Bị gỡ', cls: 'bad' },
  pending: { label: 'Chờ duyệt', cls: 'warn' },
  unreachable: { label: 'Không mở được', cls: 'warn' },
}
export const FLAGS = {
  dong_vai_hoc_vien: 'Đóng vai học viên',
  chep_tin_khach: 'Chép tin khách',
  spam_link: 'Spam link',
  sai_group: 'Sai group',
  van_mau: 'Văn mẫu lặp lại',
}

export const interactions = (r) => (r?.reactions ?? 0) + (r?.comments ?? 0) + (r?.shares ?? 0)
export const isBad = (r) => r && (r.status === 'removed' || r.status === 'hidden' || r.rule_flags?.length > 0)

export function Stars({ score }) {
  if (!score) return null
  return <span className="stars" title={`${score}/5 điểm`}>{'★'.repeat(score)}<span className="dim">{'★'.repeat(5 - score)}</span></span>
}

export default function Review({ r, kind }) {
  if (!r) return <div className="review none">Bot chưa chấm {kind === 'comment' ? 'comment' : 'bài'} này.</div>
  const st = STATUS[r.status] || STATUS.unreachable
  const c = kind === 'comment'
  const nums = [
    r.reactions != null && `${r.reactions} ${c ? 'lượt thích' : 'cảm xúc'}`,
    r.comments != null && `${r.comments} ${c ? 'trả lời' : 'bình luận'}`,
    !c && r.shares != null && `${r.shares} chia sẻ`,
    c && r.asker_replied != null && (r.asker_replied ? 'người hỏi đã phản hồi' : 'người hỏi chưa phản hồi'),
  ].filter(Boolean)
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
