/* Lớp nối Bàn việc ↔ Supabase (bảng owner_docs). Thay window.claude.use("db") của trang artifact cũ,
   giữ đúng kiểu gọi db.collection(...).onSnapshot/add/doc(id).set/update và db.doc("col/id").
   Trang này không chứa dữ liệu: chỉ tải sau khi đăng nhập đúng tài khoản Thiện (RLS chặn mọi người khác).
   Client Supabase mượn từ trang dashboard bên ngoài (cùng tên miền, cùng phiên đăng nhập). */
(function () {
  let sb = null
  try { sb = window.parent && window.parent !== window ? window.parent.__ktSb : null } catch (_) { sb = null }
  if (!sb) return // mở trực tiếp ngoài dashboard: trang hiện "Đang tải" và không có dữ liệu

  const COLS = ['tasks', 'ideas', 'focus', 'reports', 'days', 'meta']
  const cache = {}; COLS.forEach((c) => { cache[c] = new Map() })
  const loaded = {}, loading = {}
  const listeners = [] // { col, id|null, cb, err }

  const docSnap = (c, id) => { const d = cache[c].get(id); return { id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) } }
  const colSnap = (c) => ({ docs: [...cache[c].keys()].sort().map((id) => docSnap(c, id)) })
  const emit = (c) => listeners.forEach((l) => { if (l.col === c && loaded[c]) l.cb(l.id == null ? colSnap(c) : docSnap(c, l.id)) })

  async function load(c) {
    if (loading[c]) return loading[c]
    loading[c] = (async () => {
      let from = 0
      for (;;) {
        const { data, error } = await sb.from('owner_docs').select('id,data').eq('col', c).order('id').range(from, from + 999)
        if (error) throw error
        data.forEach((r) => cache[c].set(r.id, r.data))
        if (data.length < 1000) break
        from += 1000
      }
      loaded[c] = true
      emit(c)
    })()
    return loading[c].catch((e) => { loading[c] = null; listeners.forEach((l) => l.col === c && l.err && l.err(e)); throw e })
  }

  // Máy khác (hoặc lịch 10h) sửa thì trang tự cập nhật, như onSnapshot của trang cũ
  // Mỗi lần mở trang một kênh riêng (client dùng chung với dashboard, trùng tên kênh sẽ lỗi), rời trang thì đóng
  try {
    const ch = sb.channel('ban-viec-' + Date.now() + '-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_docs' }, (p) => {
        const r = p.eventType === 'DELETE' ? p.old : p.new
        if (!r || !cache[r.col]) return
        if (p.eventType === 'DELETE') cache[r.col].delete(r.id)
        else cache[r.col].set(r.id, r.data)
        emit(r.col)
      })
      .subscribe()
    addEventListener('pagehide', () => { try { sb.removeChannel(ch) } catch (_) {} })
  } catch (_) { /* mất kênh tức thời thì vẫn đọc/ghi bình thường, chỉ không tự cập nhật từ máy khác */ }

  async function put(c, id, data) {
    const before = cache[c].get(id)
    cache[c].set(id, data); emit(c) // cập nhật ngay trên màn hình rồi mới lưu
    const { error } = await sb.from('owner_docs').upsert({ col: c, id, data, updated_at: new Date().toISOString() }, { onConflict: 'col,id' })
    if (error) { before === undefined ? cache[c].delete(id) : cache[c].set(id, before); emit(c); throw error }
  }
  const newId = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; for (let i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)]; return s }

  function docRef(c, id) {
    if (!cache[c]) throw new Error('Không có bảng ' + c)
    return {
      id,
      onSnapshot(cb, err) { const l = { col: c, id, cb, err }; listeners.push(l); if (loaded[c]) cb(docSnap(c, id)); else load(c).catch(() => {}); return () => listeners.splice(listeners.indexOf(l), 1) },
      async get() { await load(c); return docSnap(c, id) },
      set(data) { return put(c, id, { ...data }) },
      async update(patch) { await load(c); const cur = cache[c].get(id); if (!cur) throw new Error('Không tìm thấy ' + c + '/' + id); return put(c, id, { ...cur, ...patch }) },
      async delete() { const before = cache[c].get(id); cache[c].delete(id); emit(c); const { error } = await sb.from('owner_docs').delete().eq('col', c).eq('id', id); if (error) { if (before) cache[c].set(id, before); emit(c); throw error } },
    }
  }
  const db = {
    collection(c) {
      if (!cache[c]) throw new Error('Không có bảng ' + c)
      return {
        onSnapshot(cb, err) { const l = { col: c, id: null, cb, err }; listeners.push(l); if (loaded[c]) cb(colSnap(c)); else load(c).catch(() => {}); return () => listeners.splice(listeners.indexOf(l), 1) },
        async add(data) { const id = newId(); await put(c, id, { ...data }); return docRef(c, id) },
        doc(id) { return docRef(c, id) },
      }
    },
    doc(path) { const [c, id] = String(path).split('/'); return docRef(c, id) },
  }
  window.claude = { use: async (k) => (k === 'db' ? db : k === 'user' ? { can: async () => true } : null) }

  // Sáng/tối đi chung với dashboard: chọn ở đây thì thanh trên cùng của dashboard đổi theo
  try {
    const t = window.parent.localStorage.getItem('kt_theme')
    if (t) localStorage.setItem('bv-theme', t)
  } catch (_) {}
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#theme button[data-t]')
    if (!b) return
    try { window.parent.__ktSetTheme && window.parent.__ktSetTheme(b.dataset.t) } catch (_) {}
  })
})()
