import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskModal } from '@ai-job-print/ui'
import { useAuth } from '../auth/useAuth'
import { loginPathForCurrentLocation } from '../auth/returnPath'
import { subscribeAiLoginRequired } from './aiLoginRequired'

/**
 * 游客点了要 AI 的功能、服务端要求先登录时，给一个直接去登录的按钮。
 * 简历、面试、小青、导出打印稿都走同一个取数层，所以挂在根上一处就覆盖每个 AI 入口。
 * 登录页按 from 回到当前这一页；已登录时不弹（那是会话失效，另有处理）。
 */
export function AiLoginRequiredHost() {
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => subscribeAiLoginRequired(() => setOpen(true)), [])

  if (!open || isLoggedIn) return null

  const close = () => setOpen(false)
  const goLogin = () => {
    setOpen(false)
    navigate(loginPathForCurrentLocation())
  }

  return (
    <KioskModal
      open
      title="这项 AI 功能要先登录"
      description="为了按规定核实使用者，AI 功能要先用手机号登录。打印、扫描不用登录，照常可用。"
      onClose={close}
      closeOnBackdrop
      closeOnEscape
      closeLabel="关闭"
      actions={(
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={close}>先不用</button>
          <button type="button" className="qx-btn" data-variant="primary" data-testid="ai-login-required-go" onClick={goLogin}>去登录</button>
        </>
      )}
    >
      <div data-ai-login-required-dialog="" />
    </KioskModal>
  )
}
