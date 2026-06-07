import { useContext } from 'react'
import { FavoritesContext, type FavoritesContextValue } from './context'

/**
 * 读取岗位收藏上下文。必须在 <FavoritesProvider> 内使用。
 * 单独成文件，使 FavoritesProvider.tsx 只导出组件（满足 react-refresh/only-export-components）。
 */
export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites 必须在 <FavoritesProvider> 内使用')
  return ctx
}
