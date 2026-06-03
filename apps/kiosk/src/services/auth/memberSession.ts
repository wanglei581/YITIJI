// ============================================================
// C 端登录会话存储（阶段 A）
//
// 公共一体机安全约束：
//   - token 只放 sessionStorage（关 tab / 换人即清），**禁止 localStorage**
//   - deviceId 用于短信多维频控的"设备维度"，同样只放 sessionStorage
//   - 不写任何持久化（localStorage / IndexedDB / cookie），防止下一个用户复用上一个人的会话
// ============================================================

const TOKEN_KEY = 'member.token'
const DEVICE_KEY = 'member.deviceId'

export function getMemberToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setMemberToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* sessionStorage 不可用时静默：宁可不登录，也不退回 localStorage */
  }
}

export function clearMemberToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** 取（或惰性生成）本会话的 deviceId，用于频控设备维度。仅 sessionStorage。 */
export function getDeviceId(): string {
  try {
    let id = sessionStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}
