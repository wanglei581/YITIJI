/**
 * 开机顺序：先拿到单实例锁，再做本进程 SID 的队列清理，然后才启动领取循环。
 * 门禁用运行时调用钉住这个顺序。只改源码里这几行字的先后，不算数。
 */
export async function runAgentBoot(steps: {
  acquireLock: () => Promise<void>
  afterLock: () => Promise<void>
  cleanupOwnPrintJobs: () => Promise<void>
  beforeClaim: () => Promise<void>
  startClaimLoop: () => void
}): Promise<void> {
  await steps.acquireLock()
  await steps.afterLock()
  await steps.cleanupOwnPrintJobs()
  await steps.beforeClaim()
  steps.startClaimLoop()
}
