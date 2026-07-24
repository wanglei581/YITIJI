import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import type { MemberAssetPage, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { getMyBrowseLogs, getMyJumpLogs } from '../../services/api/activity'
import { formatTime } from '../profile/assets/format'
import { actionLabel, detailRoute, TYPE_LABEL } from '../profile/me/activityPresentation'
import '../profile/me/me-detail-inkpaper.css'

type ActivityRecord =
  | { kind: 'browse'; item: MemberBrowseLogItem }
  | { kind: 'jump'; item: MemberJumpLogItem }

type LoadState = 'loading' | 'error' | 'ready'

async function findRecord<T extends MemberBrowseLogItem>(
  loadPage: (cursor?: string | null) => Promise<MemberAssetPage<T>>,
  id: string,
  isCancelled: () => boolean,
): Promise<T | null> {
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    if (isCancelled()) return null
    const page = await loadPage(cursor)
    const found = page.items.find((item) => item.id === id)
    if (found) return found
    cursor = page.nextCursor
    if (!cursor) return null
    if (seen.has(cursor)) throw new Error('ACTIVITY_CURSOR_REPEATED')
    seen.add(cursor)
  } while (!isCancelled())
  return null
}

export default function MeActivityDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { isLoggedIn, getToken } = useAuth()
  const [state, setState] = useState<LoadState>('loading')
  const [record, setRecord] = useState<ActivityRecord | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => setReloadKey((value) => value + 1), [])

  useEffect(() => {
    if (!isLoggedIn || !id) {
      setRecord(null)
      setState('ready')
      return
    }
    let cancelled = false
    const token = getToken()
    setState('loading')
    setRecord(null)
    Promise.all([
      findRecord(
        (cursor) => getMyBrowseLogs(token, { cursor, pageSize: 50 }),
        id,
        () => cancelled,
      ),
      findRecord(
        (cursor) => getMyJumpLogs(token, { cursor, pageSize: 50 }),
        id,
        () => cancelled,
      ),
    ]).then(([browse, jump]) => {
      if (cancelled) return
      setRecord(browse ? { kind: 'browse', item: browse } : jump ? { kind: 'jump', item: jump } : null)
      setState('ready')
    }).catch(() => {
      if (!cancelled) setState('error')
    })
    return () => { cancelled = true }
  }, [getToken, id, isLoggedIn, reloadKey])

  const item = record?.item
  return (
    <KioskPageFrame
      className="fusion-w5 fusion-w5--profile me-inkdetail me-activity-detail"
      header={<KioskPageHeader title="记录详情" description="本人浏览与打开来源入口的记录" onBack={() => navigate('/me/activity')} backLabel="返回浏览与跳转记录" />}
    >
      <section data-kiosk-domain="profile" data-kiosk-screen="activity-detail" className="me-detail-scroll">
        {!isLoggedIn ? (
          <KioskStatePanel
            tone="permission"
            title="登录后查看本人记录"
            description="游客模式不保存跨会话浏览记录"
            actions={<Button onClick={() => navigate('/login', { state: { from: `/me/activity/${id}` } })}>手机号登录</Button>}
          />
        ) : state === 'loading' ? (
          <KioskStatePanel tone="loading" title="正在加载本人记录" />
        ) : state === 'error' ? (
          <KioskStatePanel tone="error" title="暂时无法加载这条记录" actions={<Button onClick={load}>重新加载</Button>} />
        ) : !record || !item ? (
          <KioskStatePanel tone="empty" title="未找到这条记录" description="记录可能已清理，或不属于当前登录账号" />
        ) : (
          <section className="me-detail-summary" aria-label="本人浏览或跳转记录详情">
            <div>
              <p>{record.kind === 'browse' ? '浏览记录' : actionLabel(record.item.action, item.targetType)}</p>
              <h2>{item.targetTitle ?? `${TYPE_LABEL[item.targetType]}详情`}</h2>
            </div>
            <dl>
              <div><dt>内容类型</dt><dd>{TYPE_LABEL[item.targetType]}</dd></div>
              <div><dt>记录时间</dt><dd>{formatTime(item.createdAt)}</dd></div>
            </dl>
            <KioskActionBar>
              <Button onClick={() => navigate(detailRoute(item.targetType, item.targetId, item.externalId))}>查看原内容</Button>
            </KioskActionBar>
            <p>这里只记录浏览与打开来源入口动作；投递或预约结果以来源平台为准，本系统不记录。</p>
          </section>
        )}
      </section>
    </KioskPageFrame>
  )
}
