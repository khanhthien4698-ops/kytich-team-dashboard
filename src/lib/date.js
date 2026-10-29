// Mọi ngày trong app tính theo giờ Việt Nam, dạng 'YYYY-MM-DD'.
const TZ = 'Asia/Ho_Chi_Minh'

export function vnToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function rangeDays(from, to) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const WD_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export function weekday(iso, long = false) {
  const i = new Date(iso + 'T00:00:00Z').getUTCDay()
  return (long ? WD_LONG : WD)[i]
}

export function ddmm(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function longDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${weekday(iso, true)}, ${d}/${m}/${y}`
}

export function monthStart(iso) {
  return iso.slice(0, 8) + '01'
}

export function timeVN(ts) {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}
