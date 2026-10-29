import { createClient } from '@supabase/supabase-js'
import { demoClient } from './demo.js'

export const DEMO = import.meta.env.VITE_DEMO === '1'
const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN || 'aptiskytich.vn'
export const CONFIGURED = DEMO || Boolean(URL && KEY)

export const sb = DEMO ? demoClient : CONFIGURED ? createClient(URL, KEY) : null

// Đổi lỗi tiếng Anh của Supabase sang tiếng Việt cho dễ hiểu
function vi(error) {
  const m = error?.message || String(error)
  if (/Invalid login credentials/i.test(m)) return 'Sai tên đăng nhập hoặc mật khẩu.'
  if (/row-level security/i.test(m)) return 'Bạn không có quyền làm việc này.'
  if (/url_check/i.test(m)) return 'Link phải bắt đầu bằng http:// hoặc https://'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Mất kết nối mạng, thử lại nhé.'
  return m
}

async function q(promise) {
  const { data, error } = await promise
  if (error) throw new Error(vi(error))
  return data
}

// ---------- Đăng nhập ----------
export function toEmail(login) {
  const s = login.trim().toLowerCase()
  return s.includes('@') ? s : `${s}@${LOGIN_DOMAIN}`
}
export const signIn = (login, password) => q(sb.auth.signInWithPassword({ email: toEmail(login), password }))
export const signOut = () => sb.auth.signOut()
export const changePassword = (password) => q(sb.auth.updateUser({ password }))

export async function getMe(email) {
  return q(sb.from('members').select('*').eq('login_email', email.toLowerCase()).eq('active', true).maybeSingle())
}

// ---------- Danh mục ----------
export const listMembers = () => q(sb.from('members').select('*').order('sort_order').order('name'))
export const listRoutines = (memberId) => {
  let s = sb.from('routines').select('*')
  if (memberId) s = s.eq('member_id', memberId)
  return q(s.order('sort_order').order('created_at'))
}
export const listGroups = () => q(sb.from('seed_groups').select('*').order('sort_order').order('name'))

// ---------- Một ngày của một người ----------
export async function getDay(memberId, date) {
  const [checks, extras, posts, notes, reports] = await Promise.all([
    q(sb.from('daily_checks').select('*').eq('member_id', memberId).eq('date', date)),
    q(sb.from('extra_tasks').select('*').eq('member_id', memberId).eq('date', date).order('created_at')),
    q(sb.from('seeding_posts').select('*').eq('member_id', memberId).eq('date', date).order('created_at')),
    q(sb.from('day_notes').select('*').eq('member_id', memberId).eq('date', date)),
    q(sb.from('team_reports').select('*').eq('member_id', memberId).eq('date', date)),
  ])
  return { checks, extras, posts, note: notes[0] || null, report: reports[0] || null }
}

export const saveCheck = (row) =>
  q(sb.from('daily_checks').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'date,member_id,routine_id' }).select().single())

export const addExtra = (row) => q(sb.from('extra_tasks').insert(row).select().single())
export const updateExtra = (id, patch) => q(sb.from('extra_tasks').update(patch).eq('id', id))
export const deleteExtra = (id) => q(sb.from('extra_tasks').delete().eq('id', id))

export const addPost = (row) => q(sb.from('seeding_posts').insert(row).select().single())
export const deletePost = (id) => q(sb.from('seeding_posts').delete().eq('id', id))

export const saveDayNote = (row) =>
  q(sb.from('day_notes').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'date,member_id' }).select().single())

// ---------- Gợi ý seeding ----------
export const listIdeas = (date) => q(sb.from('seed_ideas').select('*').eq('date', date).order('created_at'))
export async function takeIdea(id) {
  const ok = await q(sb.rpc('take_idea', { p_idea: id }))
  if (!ok) throw new Error('Thẻ này vừa có người khác lấy rồi.')
}
export const releaseIdea = (id) => q(sb.rpc('release_idea', { p_idea: id }))

// ---------- Bảng tổng (admin) ----------
export async function getRange(from, to) {
  const r = (t) => q(sb.from(t).select('*').gte('date', from).lte('date', to))
  const [checks, extras, posts, notes] = await Promise.all([r('daily_checks'), r('extra_tasks'), r('seeding_posts'), r('day_notes')])
  return { checks, extras, posts, notes }
}
export const listIdeasRange = (from, to) => q(sb.from('seed_ideas').select('*').gte('date', from).lte('date', to))
export const listReports = (from, to) =>
  q(sb.from('team_reports').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }))

// ---------- Cài đặt (admin) ----------
function saver(table) {
  return ({ id, ...row }) =>
    id ? q(sb.from(table).update(row).eq('id', id).select().single()) : q(sb.from(table).insert(row).select().single())
}
export const saveMember = saver('members')
export const saveRoutine = saver('routines')
export const saveGroup = saver('seed_groups')
