import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { getResumeRecord } from '../../services/api'
import { resumeBlocksToGenerateForm } from './resumeBlocksToGenerateForm'

/** 优化失败后的「手动逐项修改」：有 taskId 就取一次诊断报告，带得动就回填表单。 */
export function useManualEditCarry(taskId: string | undefined, accessToken: string | undefined): {
  manualPending: boolean
  onManualEdit: () => void
} {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [manualPending, setManualPending] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const onManualEdit = useCallback(() => {
    if (!taskId) {
      navigate('/resume/generate')
      return
    }
    if (busy.current) return
    busy.current = true
    setManualPending(true)
    void getResumeRecord(taskId, { token: getToken(), accessToken })
      .then((record) => {
        if (!alive.current) return
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
      })
      .catch(() => {
        if (!alive.current) return
        navigate('/resume/generate')
      })
  }, [accessToken, getToken, navigate, taskId])

  return { manualPending, onManualEdit }
}
