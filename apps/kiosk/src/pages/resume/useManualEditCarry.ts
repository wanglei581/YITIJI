import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getResumeRecord } from '../../services/api'
import { resumeBlocksToGenerateForm } from './resumeBlocksToGenerateForm'

/**
 * 优化失败后的「手动逐项修改」：有 taskId 就取一次诊断报告，带得动就回填表单。
 * active 为假（退路区已不在屏上，比如同一页重试后出了结果），或 taskId 变了，
 * 还没回来的那次请求作废：回来后只把按钮复位，不再把人带走。
 */
export function useManualEditCarry(taskId: string | undefined, accessToken: string | undefined, active = true): {
  manualPending: boolean
  onManualEdit: () => void
} {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [manualPending, setManualPending] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)
  const generation = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    generation.current += 1
  }, [taskId, active])

  const onManualEdit = useCallback(() => {
    if (!taskId) {
      navigate('/resume/generate')
      return
    }
    if (busy.current) return
    busy.current = true
    setManualPending(true)
    const mine = generation.current
    const settle = (go: () => void) => {
      if (!alive.current) return
      busy.current = false
      setManualPending(false)
      if (mine !== generation.current) return
      go()
    }
    void getResumeRecord(taskId, { token: getToken(), accessToken })
      .then((record) => settle(() => {
        const carried = resumeBlocksToGenerateForm(record.report?.contentBlocks)
        if (!carried) {
          navigate('/resume/generate')
          return
        }
        navigate('/resume/generate', {
          state: {
            generateHandoff: {
              step: 0,
              seg: carried.seg,
              form: carried.form,
              carried: true,
            },
          },
        })
      }))
      .catch(() => settle(() => navigate('/resume/generate')))
  }, [accessToken, getToken, navigate, taskId])

  return { manualPending, onManualEdit }
}
