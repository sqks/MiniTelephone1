let currentUid = null
let adminToken = null

export function setCurrentUid(uid) {
  currentUid = uid
  if (uid) localStorage.setItem('mt_uid', String(uid))
  else localStorage.removeItem('mt_uid')
}

export function loadStoredUid() {
  const raw = localStorage.getItem('mt_uid')
  const uid = raw ? Number(raw) : null
  if (uid && Number.isInteger(uid) && uid > 0) {
    currentUid = uid
    return uid
  }
  localStorage.removeItem('mt_uid')
  return null
}

export function setAdminToken(token) {
  adminToken = token
  if (token) localStorage.setItem('mt_admin_token', token)
  else localStorage.removeItem('mt_admin_token')
}

export function loadAdminToken() {
  const token = localStorage.getItem('mt_admin_token')
  if (token) {
    adminToken = token
    return token
  }
  return null
}

async function parse(res) {
  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  return res.json()
}

function request(path, init = {}) {
  const headers = { ...(init.headers || {}) }
  if (currentUid) headers['x-account-id'] = String(currentUid)
  return fetch('/api' + path, { ...init, headers }).then(parse)
}

function adminRequest(path, init = {}) {
  const headers = { ...(init.headers || {}), 'x-admin-token': adminToken || '' }
  return fetch('/api' + path, { ...init, headers }).then(parse)
}

function json(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  // 公开
  getMode: () => request('/mode'),
  register: (data) => request('/register', json('POST', data)),
  registerStatus: (id) => request(`/register/status/${id}`),
  loginWithUid: (uid) => fetch('/api/me', { headers: { 'x-account-id': String(uid) } }).then(parse),

  // 当前用户
  getMe: () => request('/me'),
  updateMe: (data) => request('/me', json('PUT', data)),

  listAvatars: () => request('/me/avatars'),
  uploadAvatar: (file) => {
    const fd = new FormData()
    fd.append('avatar', file)
    return request('/me/avatar', { method: 'POST', body: fd })
  },
  useAvatar: (id) => request(`/me/avatars/${id}/use`, { method: 'POST' }),
  deleteAvatar: (id) => request(`/me/avatars/${id}`, { method: 'DELETE' }),

  // 好友
  listFriends: () => request('/friends'),
  addFriend: (uid) => request('/friends', json('POST', { uid })),
  removeFriend: (uid) => request(`/friends/${uid}`, { method: 'DELETE' }),
  lookupUser: (uid) => request(`/users/lookup/${uid}`),

  // 聊天
  listConversations: () => request('/conversations'),
  listMessages: (peer, after) => request(`/messages/${peer}${after ? `?after=${after}` : ''}`),
  sendText: (peer, content) => request(`/messages/${peer}`, json('POST', { content })),
  sendFile: (peer, file, duration) => {
    const fd = new FormData()
    fd.append('file', file)
    if (duration) fd.append('duration', String(duration))
    return request(`/messages/${peer}/file`, { method: 'POST', body: fd })
  },
  markRead: (peer) => request(`/messages/${peer}/read`, json('POST', {})),

  // 群聊
  getGroup: (id) => request(`/groups/${id}`),
  listGroupMessages: (id, after) => request(`/groups/${id}/messages${after ? `?after=${after}` : ''}`),
  sendGroupText: (id, content) => request(`/groups/${id}/messages`, json('POST', { content })),
  sendGroupFile: (id, file, duration) => {
    const fd = new FormData()
    fd.append('file', file)
    if (duration) fd.append('duration', String(duration))
    return request(`/groups/${id}/messages/file`, { method: 'POST', body: fd })
  },

  // 翻译（DeepSeek）
  translate: (text, target) => request('/translate', json('POST', { text, target })),

  // 我的信息
  listEntries: () => request('/entries'),
  createEntry: (items) => request('/entries', json('POST', { items })),
  updateEntry: (id, items) => request(`/entries/${id}`, json('PUT', { items })),
  deleteEntry: (id) => request(`/entries/${id}`, { method: 'DELETE' }),
  listTags: () => request('/tags'),

  // 管理面板
  adminOverview: () => adminRequest('/admin/overview'),
  adminSetMode: (mode) => adminRequest('/admin/settings', json('PUT', { mode })),
  adminChangeToken: (next) => adminRequest('/admin/token', json('PUT', { next })),
  adminListRequests: (status = 'pending') => adminRequest(`/admin/requests?status=${status}`),
  adminApprove: (id, uid) =>
    adminRequest(`/admin/requests/${id}/approve`, json('POST', uid ? { uid } : {})),
  adminReject: (id) => adminRequest(`/admin/requests/${id}/reject`, json('POST', {})),
  adminListUsers: () => adminRequest('/admin/users'),
  adminCreateUser: (data) => adminRequest('/admin/users', json('POST', data)),
  adminDeleteUser: (uid) => adminRequest(`/admin/users/${uid}`, { method: 'DELETE' }),
  adminGetIntegrations: () => adminRequest('/admin/integrations'),
  adminSetIntegration: (deepseekApiKey) =>
    adminRequest('/admin/integrations', json('PUT', { deepseek_api_key: deepseekApiKey })),
  adminListGroups: () => adminRequest('/admin/groups'),
  adminCreateGroup: (data) => adminRequest('/admin/groups', json('POST', data)),
  adminDeleteGroup: (id) => adminRequest(`/admin/groups/${id}`, { method: 'DELETE' }),
  adminAddGroupMember: (id, uid) => adminRequest(`/admin/groups/${id}/members`, json('POST', { uid })),
  adminRemoveGroupMember: (id, uid) =>
    adminRequest(`/admin/groups/${id}/members/${uid}`, { method: 'DELETE' }),
  adminGetStorage: () => adminRequest('/admin/storage'),
  adminClearMessages: () => adminRequest('/admin/data/messages', { method: 'DELETE' }),
  adminClearAll: () => adminRequest('/admin/data/all', { method: 'DELETE' }),
  adminExportData: async () => {
    const res = await fetch('/api/admin/export', { headers: { 'x-admin-token': adminToken || '' } })
    if (!res.ok) {
      let message = `导出失败（${res.status}）`
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch {
        // keep default
      }
      throw new Error(message)
    }
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="?([^";]+)"?/)
    return { blob: await res.blob(), filename: m ? m[1] : 'minitelephone-backup.zip' }
  },
}
