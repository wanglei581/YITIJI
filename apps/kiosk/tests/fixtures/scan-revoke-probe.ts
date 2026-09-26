import { expect, type Page } from '@playwright/test'

export interface ScanRevokeProbeSnapshot {
  /** 确认（ACK）的回话被页面读完、并且紧跟其后的那串微任务已经跑完的次数。 */
  ackConsumed: number
  /** 页面**调用过**几次 `fetch(DELETE /scan/sessions/:id)`（不论它后来到没到路由）。 */
  deletes: number
}

const REPORT_BINDING = '__scanRevokeProbeReport'

/**
 * 页内记账：这一页调用过几次 DELETE，以及确认回话被页面消化了几次。
 *
 * 两样都只能在页面里记，路由计数替代不了：
 *   · 路由计数是**异步**的：页面调用 fetch 之后，要经过一次浏览器 → Playwright 的往返
 *     handler 才 +1。断言排在这次往返前面，读到的 0 什么也证明不了；
 *   · 「确认回话已经被处理完」只有页面自己知道。等待页的确认回调（ScanProgressPage 的
 *     ACK effect）是在响应体 `json()` 落定之后那一串**微任务**里跑的，它要发 DELETE
 *     就在那串里同步调用 fetch。所以在 `json()` 落定时排一个宏任务：它跑起来的那一刻，
 *     那串微任务连同其中任何一次 DELETE 调用必然都已经跑完 —— 这是事件循环的顺序保证，
 *     不是「等得够久」。（哪天那段回调里多了一次 await 宏任务，这个信号就要跟着改。）
 *
 * 装在文档最前面（addInitScript），所以页面自己后来包的 fetch（隐私守卫就包了一层）
 * 都包在它外面，每一次调用都会穿过它。
 *
 * 记账由页面**推**给用例（exposeFunction），不由用例去 evaluate 着拉：清场之后那次重载
 * 一旦发出，Playwright 就不再往旧文档里 evaluate 了，而恰恰是那一段要看。绑定调用按发生
 * 顺序送达，所以用例收到「ACK 已消化」时，同一串里的 DELETE 上报一定已经先到了。
 * 每份文档带一个编号，只认第一份上报的文档：重载之后的新文档从零记起，不许把它混进来。
 */
export async function installScanRevokeProbe(
  page: Page,
  scanTaskId: string,
): Promise<() => Promise<ScanRevokeProbeSnapshot | null>> {
  let snapshot: ScanRevokeProbeSnapshot | null = null
  let reportingDocument: string | null = null
  await page.exposeFunction(REPORT_BINDING, (report: ScanRevokeProbeSnapshot & { documentId: string }) => {
    reportingDocument ??= report.documentId
    if (report.documentId !== reportingDocument) return
    snapshot = { ackConsumed: report.ackConsumed, deletes: report.deletes }
  })
  await page.addInitScript(({ ackPath, taskPath, binding }) => {
    const probe = { ackConsumed: 0, deletes: 0 }
    const documentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const report = (): void => {
      const send = (window as unknown as Record<string, unknown>)[binding]
      if (typeof send === 'function') void (send as (value: unknown) => Promise<void>)({ documentId, ...probe })
    }
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request ? request.url : String(input), window.location.href)
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
      if (method === 'DELETE' && url.pathname === taskPath) {
        probe.deletes += 1
        report()
      }
      const pending = nativeFetch(input, init)
      if (method !== 'POST' || url.pathname !== ackPath) return pending
      return pending.then((response) => {
        const nativeJson = response.json.bind(response)
        response.json = () => nativeJson().finally(() => {
          window.setTimeout(() => {
            probe.ackConsumed += 1
            report()
          }, 0)
        })
        return response
      })
    }
  }, {
    ackPath: `/api/v1/scan/sessions/${scanTaskId}/ack`,
    taskPath: `/api/v1/scan/sessions/${scanTaskId}`,
    binding: REPORT_BINDING,
  })
  return async () => (snapshot ? { ...snapshot } : null)
}

/** 等确认回话被页面消化完，交回**满足条件的那一份**快照（不另读第二次）。 */
export async function waitForAckConsumed(
  readProbe: () => Promise<ScanRevokeProbeSnapshot | null>,
): Promise<ScanRevokeProbeSnapshot> {
  const last: { snapshot: ScanRevokeProbeSnapshot | null } = { snapshot: null }
  await expect.poll(async () => {
    last.snapshot = await readProbe()
    return last.snapshot?.ackConsumed ?? 0
  }, { message: '确认回话必须被页面读完：这之后才谈得上「它有没有补发 DELETE」' }).toBe(1)
  return last.snapshot!
}
