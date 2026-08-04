// JobsServiceHubPage — 岗位信息服务中心（/jobs-service）
// TODO: 实现完整服务中心页面

import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'

export function JobsServiceHubPage() {
  const navigate = useNavigate()
  return (
    <KioskPageFrame>
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <KioskPageHeader
          title="岗位信息"
          description="查看第三方来源岗位 · AI岗位研判"
          onBack={() => navigate('/')}
          backLabel="返回"
        />
        <div className="mt-8 flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="rounded-[var(--radius-lg)] border border-neutral-200 bg-surface px-10 py-6 text-[22px] font-bold text-neutral-900 shadow-sm active:scale-[0.99]"
          >
            查看岗位列表
          </button>
        </div>
      </div>
    </KioskPageFrame>
  )
}
