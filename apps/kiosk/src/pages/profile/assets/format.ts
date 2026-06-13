// ProfilePage 本次会话记录的时间展示工具。
// 旧「账号资产」聚合明细组件已删除；不要在「我的」页重新引入聚合资产面板。

export function formatTime(iso: string) {
  const d = new Date(iso)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}月${D}日 ${h}:${m}`
}
