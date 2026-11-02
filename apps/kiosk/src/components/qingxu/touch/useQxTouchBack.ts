import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/** 没传 onBack 时：站内还有上一页就回退，否则回首页。 */
export function useQxTouchBack(onBack?: () => void) {
  const navigate = useNavigate()
  return useCallback(() => {
    if (onBack) {
      onBack()
      return
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }, [navigate, onBack])
}
