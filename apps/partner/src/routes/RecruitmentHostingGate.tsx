import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, LoadingState } from '@ai-job-print/ui'
import { InfoIcon } from 'lucide-react'
import { Page } from './Page'
import { useRecruitmentHosting } from '../services/capabilities'

type RecruitmentHostedPage = 'jobs' | 'companies' | 'fairs' | 'sources' | 'sync-logs'

const PAGE_META: Record<RecruitmentHostedPage, { title: string; subject: string }> = {
  jobs: { title: '岗位信息管理', subject: '岗位信息' },
  companies: { title: '企业资料管理', subject: '企业资料' },
  fairs: { title: '招聘会信息管理', subject: '招聘会信息' },
  sources: { title: '数据源管理', subject: '岗位与招聘会的数据源接入' },
  'sync-logs': { title: '同步日志', subject: '岗位与招聘会的数据同步' },
}

/**
 * 招聘内容托管关闭（3.13，我们云上默认）时，岗位 / 企业 / 招聘会 / 数据源 / 同步日志整块下线：
 * 侧栏已隐藏，但直接输入地址或旧书签仍能到达这里。此时不渲染原管理页
 * （列表恒为空、写入一律 403，看起来像「数据丢了」或「系统坏了」），而是如实说明原因与去向。
 *
 * 只描述开关的行为，不宣称存量数据已清理（CLAUDE.md §1）。
 * 能力还在加载时先等，不抢先发请求；能力接口失败时沿用 fail-open，照常渲染原页，由服务端兜底。
 */
export function RecruitmentHostingGate({ page, children }: { page: RecruitmentHostedPage; children: ReactNode }) {
  const hosting = useRecruitmentHosting()
  const navigate = useNavigate()
  const meta = PAGE_META[page]

  if (hosting === 'loading') {
    return (
      <Page title={meta.title}>
        <LoadingState text="正在确认本平台开放的功能…" className="py-20" />
      </Page>
    )
  }
  if (hosting !== 'off') return <>{children}</>

  return (
    <Page title={meta.title} subtitle="本平台未开放此功能">
      <Card className="mx-auto max-w-2xl p-8 text-center" role="status" aria-label="本平台未开放此功能">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-info-bg text-info-fg">
          <InfoIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-[15px] font-bold text-neutral-800">本平台不提供{meta.subject}托管</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          本平台已关闭岗位、招聘会与企业资料的托管：不接收导入与同步，也不在一体机和小程序上展示这类内容，
          所以这一页在这里不可用。这不是故障，也不是本机构的数据出了问题。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          本机构的政策公告仍可在「政策公告管理」里自行审核、发布。
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          如需在本机构自己的服务器上运营岗位与招聘会，请联系平台了解私有化部署。
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Button size="sm" variant="primary" onClick={() => navigate('/policy')}>
            去政策公告管理
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回工作台
          </Button>
        </div>
      </Card>
    </Page>
  )
}
