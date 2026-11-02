import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'

/**
 * 打印链上「去我的文档选一份来打印」的唯一落点。
 * 我的文档页按 ?pick=print 进「选一份来打印」模式（文件按能打印的排前面，能直接回到打印台）；
 * 服务台「其他工具」里那块「我的文档」磁贴是普通查看，不走这里、不带 pick。
 */
export const PRINT_PICK_DOCUMENTS_PATH = '/me/documents?pick=print'

export function usePickPrintDocuments(): () => void {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  return () => {
    if (isLoggedIn) navigate(PRINT_PICK_DOCUMENTS_PATH)
    else navigate('/login', { state: { from: PRINT_PICK_DOCUMENTS_PATH } })
  }
}
