import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { MemberAssetPage, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { getMyBrowseLogs, getMyJumpLogs } from '../../services/api/activity'
import { formatTime } from '../profile/assets/format'
import { actionLabel, detailRoute, TYPE_LABEL } from '../profile/me/activityPresentation'
import { QxMePage } from '../profile/me/qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from '../profile/me/qx/QxMeStateBits'
import { MeRows, MeStatic } from '../profile/touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../profile/touch/MeStatePacks'
import '../profile/me/styles/member-records-qx.css'

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
      findRecord((cursor) => getMyBrowseLogs(token, { cursor, pageSize: 50 }), id, () => cancelled),
      findRecord((cursor) => getMyJumpLogs(token, { cursor, pageSize: 50 }), id, () => cancelled),
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
  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : !record || !item ? 'not-found' : 'detail'
  let inner: ReactNode
  if (!isLoggedIn) {
    inner = <QxMeLoginBlock title="登录后查看本人记录" />
  } else if (state === 'loading') {
    inner = <QxMeLoadingBlock title="正在读取这条记录" />
  } else if (state === 'error') {
    inner = <QxMeErrorBlock onRetry={load} />
  } else if (!record || !item) {
    inner = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack sentence="记录可能已清理，或不属于当前登录账号。本页不会拿别的记录顶替。">
          <MeExitCard art="checklist" artWidth={120} title="回到记录列表" desc="列表里只显示本人记录" onClick={() => navigate('/me/activity')} />
          <MeExitCard art="usb" artWidth={120} title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
        </MeEmptyPack>
      </div>
    )
  } else {
    const actionText = record.kind === 'browse' ? '浏览' : actionLabel(record.item.action, item.targetType)
    inner = (
      <>
        <p className="me-p" data-testid="member-records-detail">
          {record.kind === 'browse' ? '浏览记录' : actionText} · 仅本人可见。这里只记录浏览与打开来源入口动作；投递或预约结果以来源平台为准，本系统不记录也不参与。
        </p>
        <MeRows few label="这条记录包含的内容" testId="member-records-detail-fields">
          <MeStatic data-detail-field="0" title={`内容类型 · ${TYPE_LABEL[item.targetType]}`} lines={[`这条记录指向一条来源${TYPE_LABEL[item.targetType]}`]} />
          <MeStatic data-detail-field="1" title={`记录动作 · ${actionText}`} lines={['只记「看过」或「打开来源入口」这个动作，不是投递，也不是预约']} />
          <MeStatic data-detail-field="2" title={`记录时间 · ${formatTime(item.createdAt)}`} lines={['由系统返回，这台机器上不留存明细']} />
          <MeStatic data-detail-field="3" title={`来源机构 · ${item.sourceName ?? '以详情页为准'}`} lines={['来源机构与外部投递入口以岗位详情页为准']} />
          <MeStatic data-detail-field="4" title="可见范围 · 仅本人可见" lines={['退出或超时后，本机不保留这条记录的明细']} />
        </MeRows>
      </>
    )
  }

  const ctabar = uiState === 'error' ? (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={load}>重新加载</button>
  ) : uiState === 'login' ? (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/login', { state: { from: `/me/activity/${id}` } })}>去登录</button>
  ) : uiState === 'loading' ? (
    <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="member-records-primary">记录还未加载完成</span>
  ) : uiState === 'not-found' ? (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/me/activity')}>返回记录列表</button>
  ) : (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => item && navigate(detailRoute(item.targetType, item.targetId, item.externalId))}>查看原内容</button>
  )

  const bandTitle = uiState === 'not-found' ? '未找到这条记录' : item?.targetTitle ?? (item ? `${TYPE_LABEL[item.targetType]}详情` : '记录详情')

  return (
    <QxMePage
      title={bandTitle}
      view="activity-detail"
      screen="activity-detail"
      screenState={`activity-detail-${uiState}`}
      eyebrow="记录详情"
      sub={uiState === 'not-found' ? '可能已清理，或不属于当前账号' : undefined}
      fine="投递 / 预约结果以来源平台为准，本系统不记录也不参与。离开 3 分钟没操作会自动退出。"
      ctabar={ctabar}
    >
      {/* 登录门、读取中、读不到、没找到四态和别的记录页一样直接放在页面容器里，出口卡才能撑满余高；
          只有真有这条记录时才进字段清单的滚动容器。 */}
      {uiState === 'detail' ? (
        <section className="me-detail-scroll">
          <div className="me-page">{inner}</div>
        </section>
      ) : inner}
    </QxMePage>
  )
}
