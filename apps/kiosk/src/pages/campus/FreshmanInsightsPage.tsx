import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CampusRecruitmentStatsData } from '@ai-job-print/shared'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { getCampusRecruitmentStats } from '../../services/api'
import { RtFrame } from '../recruitment-touch/RtFrame'
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
    <RtFrame
      eyebrow="私有化版 · 校园招聘"
      title="校园招聘数据"
      sub="经核验来源的聚合统计，不含录用或候选人指标"
      status={status === 'loading'
        ? { text: '正在读取统计' }
        : status === 'error'
          ? { text: '统计这次没读到', tone: 'warn' }
          : status === 'empty'
            ? { text: '暂无经核验的校园招聘统计' }
            : { text: '经核验统计已读到' }}
      backLabel="返回校园招聘"
      onBack={back}
      primary={{ label: '查看招聘会', onClick: goFairs }}
    >
      {status === 'loading' ? (
        <QxTouchCallout kind="howto">正在读取经核验的校园招聘统计。</QxTouchCallout>
      ) : null}

      {status === 'error' ? (
        <>
          <QxTouchCallout kind="remind">校园招聘统计暂时无法读取。没有编造数字。请稍后重试，或查看具体招聘会。</QxTouchCallout>
          <button type="button" className="rt-textbtn" onClick={retry}>重新加载</button>
        </>
      ) : null}

      {status === 'empty' ? (
        <QxTouchCallout kind="howto">
          暂无经核验的校园招聘统计。当前没有经核验的校园招聘聚合统计，请查看具体招聘会；不会展示示例数据。
        </QxTouchCallout>
      ) : null}

      {status === 'ready' && data ? <CampusInsightsGroups data={data} /> : null}
    </RtFrame>
  )
}
