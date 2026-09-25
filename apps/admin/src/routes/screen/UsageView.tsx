import { TwinSlot, TwinStatePanel } from '@ai-job-print/ui'
import { TwinShell, TwinShellEmpty, useAdminSnapshot, type ScreenChrome } from './screenView'

/** 服务调用：统计接口合入前的过渡视图（不显示任何数值）。 */
export function UsageView({ chrome }: { chrome: ScreenChrome }) {
  const gov = useAdminSnapshot('gov', 60)
  if (!gov.data) {
    return <TwinShellEmpty chrome={chrome} title="系统使用与服务调用态势" subtitle="数字孪生 · 服务调用" failure={gov.failure} onRetry={() => void gov.refresh()} />
  }
  return (
    <TwinShell chrome={chrome} title="系统使用与服务调用态势" subtitle="数字孪生 · 服务调用" layout="full" snapshot={gov.data} pollSeconds={60} failure={gov.failure} onRefresh={() => void gov.refresh()} refreshing={gov.status === 'loading'}>
      <TwinSlot slot="full">
        <TwinStatePanel title="服务调用统计正在接入" description="统计接口合入后，这里显示渠道、时段、服务步骤与 AI 服务的真实计数。接入前不显示任何数字。" />
      </TwinSlot>
    </TwinShell>
  )
}
