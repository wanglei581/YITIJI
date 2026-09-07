import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskStatePanel } from '@ai-job-print/ui'
import type { CampusRecruitmentStatsData } from '@ai-job-print/shared'
import { getCampusRecruitmentStats } from '../../services/api'
import { KioskPageFrame } from '../jobs/components/W4Presentation'
import { CampusInsightsGroups } from './CampusInsightsGroups'

type PageStatus = 'loading' | 'ready' | 'empty' | 'error'

export default function FreshmanInsightsPage() {
  const navigate = useNavigate()
  const back = () => navigate('/campus')
  const goFairs = () => navigate('/job-fairs')

  const [status, setStatus] = useState<PageStatus>('loading')
  const [data, setData] = useState<CampusRecruitmentStatsData | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    getCampusRecruitmentStats()
      .then((stats) => {
        if (cancelled) return
        setData(stats)
        setStatus(stats.groups.length === 0 ? 'empty' : 'ready')
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <KioskPageFrame
      tone="wheat"
      title="校园招聘数据"
      subtitle="经核验来源的聚合统计，不含录用或候选人指标"
      backLabel="返回校园招聘"
      onBack={back}
      actionBar={
        <>
          <button type="button" className="jf-btn ghost" onClick={back}>
            返回校园招聘
          </button>
          <div className="jf-spacer" />
          <button type="button" className="jf-btn dark" onClick={goFairs}>
            查看招聘会
          </button>
        </>
      }
    >
      {status === 'loading' ? (
        <KioskStatePanel tone="loading" title="正在读取经核验的校园招聘统计" />
      ) : null}

      {status === 'error' ? (
        <KioskStatePanel
          tone="error"
          title="校园招聘统计暂时无法读取"
          description="没有编造数字。请稍后重试，或查看具体招聘会。"
          actions={
            <button type="button" className="jf-btn sm dark" onClick={retry}>
              重新加载
            </button>
          }
        />
      ) : null}

      {status === 'empty' ? (
        <KioskStatePanel
          tone="empty"
          title="暂无经核验的校园招聘统计"
          description="当前没有经核验的校园招聘聚合统计，请查看具体招聘会；不会展示示例数据。"
        />
      ) : null}

      {status === 'ready' && data ? <CampusInsightsGroups data={data} /> : null}
    </KioskPageFrame>
  )
}
