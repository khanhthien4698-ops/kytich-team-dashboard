// DỰ PHÒNG (chưa deploy): MCP từ xa cho Muse, chỉ dùng nếu Muse bắt buộc kết nối dạng MCP thay vì gọi REST.
// Không giữ khoá bí mật nào: chỉ chuyển lời gọi tool sang 3 hàm SQL 010 bằng anon key công khai, kèm mã Muse
// lấy từ header Authorization: Bearer <mã> hoặc x-muse-key. Mã được kiểm trong DB (muse_kiem_ma).
// Deploy: Supabase → Edge Functions → Deploy new function → tên "muse-mcp" → dán file này → TẮT "Verify JWT".
// Địa chỉ cho Muse: https://jnlklvsuaqwizlohiknx.supabase.co/functions/v1/muse-mcp

const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const itemsSchema = (props: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: { items: { type: 'array', maxItems: 50, items: { type: 'object', properties: props, required } } },
  required: ['items'],
})
const link = { type: 'string', description: 'Permalink https://www.facebook.com/groups/<mã group>/posts/<mã bài>/' }
const TOOLS = [
  {
    name: 'them_bai_can_tra_loi', fn: 'muse_them_bai_can_tra_loi',
    description: 'Ghi bài mới cần trả lời (chỉ 2 group Key Aptis miễn phí và Hội review đề Aptis có tâm). Trùng link tự bỏ qua, tự chia người.',
    inputSchema: itemsSchema({ url: link, question: { type: 'string', description: 'Nội dung bài nguyên văn, đã che tên/SĐT/email bằng [...]' }, angle: { type: 'string', description: '1 câu gợi ý trả lời' } }, ['url', 'question']),
  },
  {
    name: 'them_review', fn: 'muse_them_review',
    description: 'Ghi review đề thi thật (người đi thi kể lại đề). Không ghi tên người đăng. Trùng link tự bỏ qua.',
    inputSchema: itemsSchema({ url: link, group: { type: 'string' }, posted_at: { type: 'string', description: 'dd/mm HH:MM giờ VN' }, exam_date: { type: 'string' }, shift: { type: 'string', description: 'sáng / chiều / không rõ' }, location: { type: 'string' }, content: { type: 'string', description: 'Nguyên văn phần đề' } }, ['url', 'content']),
  },
  {
    name: 'them_lang_nghe', fn: 'muse_them_lang_nghe',
    description: 'Ghi một chỗ nhắc tới Kỳ Tích, đối thủ hoặc Aptis One/Lab. Trùng link + trích dẫn tự bỏ qua.',
    inputSchema: itemsSchema({ kind: { type: 'string', enum: ['ky_tich', 'doi_thu', 'aptis_one_lab'] }, label: { type: 'string', description: 'Tên đối thủ' }, level: { type: 'string', enum: ['cao', 'vua', 'thap'] }, posted_at: { type: 'string' }, group: { type: 'string' }, author: { type: 'string', description: 'Tên hiển thị, ẩn danh ghi "Ẩn danh"' }, quote: { type: 'string', description: 'Trích ngắn dưới 2 câu' }, sentiment: { type: 'string', description: 'khen / chê / hỏi / so sánh' }, url: link }, ['kind', 'level', 'quote', 'url']),
  },
]

const reply = (id: unknown, result: unknown) => Response.json({ jsonrpc: '2.0', id, result })
const fail = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message } })

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('Kỳ Tích × Muse MCP: dùng POST JSON-RPC', { status: 200 })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const key = req.headers.get('x-muse-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let msg: { id?: unknown; method?: string; params?: { name?: string; arguments?: { items?: unknown } } }
  try { msg = await req.json() } catch { return fail(null, -32700, 'JSON lỗi') }
  const { id, method, params } = msg
  if (method === 'initialize') {
    return reply(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'kytich-dashboard', version: '1.0.0' } })
  }
  if (method?.startsWith('notifications/')) return new Response(null, { status: 202 })
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ fn: _fn, ...t }) => t) })
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name)
    if (!tool) return fail(id, -32602, 'Không có tool ' + params?.name)
    if (!key) return reply(id, { isError: true, content: [{ type: 'text', text: 'Thiếu mã kết nối (Authorization: Bearer <mã>)' }] })
    const r = await fetch(`${URL}/rest/v1/rpc/${tool.fn}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'x-muse-key': key },
      body: JSON.stringify({ items: params?.arguments?.items ?? [] }),
    })
    const text = await r.text()
    return reply(id, { isError: !r.ok, content: [{ type: 'text', text }] })
  }
  return fail(id, -32601, 'Không hỗ trợ ' + method)
})
