function pad(n) {
  return n < 10 ? `0${n}` : String(n)
}

export function formatTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`

  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startOfToday) return hm
  if (d.getTime() >= startOfToday - 86_400_000) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
