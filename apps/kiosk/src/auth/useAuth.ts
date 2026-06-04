import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './context'

/**
 * 读取 Kiosk C 端会话上下文。必须在 <AuthProvider> 内使用。
 * 单独成文件，使 AuthContext.tsx 只导出组件（满足 react-refresh/only-export-components）。
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}
