import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { revokeLiveScanSession } from './scanSessionRevoke'
import { type ScanType } from './scanWorkbench'
import { clearScanWorkbenchSession } from './scanWorkbenchSession'
import { type PrintMaterialSource } from '../print/printMaterialSession'
import { beginPrintHandoff, printHandoffTarget } from '../print/printHandoff'
import { usePrintHandoffOwner } from '../print/usePrintHandoff'
import type { ScannedFile } from './scanResultModel'

/**
 * 结果页的出口：离开整条扫描流程（`leaveScanFlow`）、拿去打印、前往我的文档、AI 简历识别。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：`leaveScanFlow` 先撤服务端任务、再清本机登记、最后 replace 导航的顺序，
 * 和每个出口都必须走它这一条，都是拆分前的原文；各段注释也原样带着。
 */
export function useScanResultExits(input: { file: ScannedFile | undefined; scanType: ScanType }) {
  const navigate = useNavigate()
  const printOwner = usePrintHandoffOwner()
  const { isLoggedIn, getToken } = useAuth()
  const { file, scanType } = input

  /**
   * 离开整条扫描流程 —— 结果页 ctabar / 底部那几个出口。
   *
   * 语义必须和 `ScanWorkbenchChrome` 的 `leaveScanFlow` 一模一样（顶栏返回、底栏三项
   * 走的是那一条）。此前这几个出口只是裸 `navigate`，同一屏上就成了两种命运：从顶栏
   * 走的人本机登记被清干净，从这里走的人把 live 登记（含刚结束那一场的 controlToken
   * 明文）和那枚一次性重扫授权**一起留在原地**，下一位用户走到这台机器前就继承了 ——
   * 授权会被他拿去对一个不属于他的任务发重扫请求，登记里那份凭证则一直躺到下次清场。
   *
   * 撤销那一句对已终态的任务是 no-op：`revokeLiveScanSession` 见到结果快照就不发 DELETE
   * （scanSessionRevoke 的 hasResult 分支）。留着它是为了「离开的语义只有一份」——
   * 结果页也可能在只有 live、还没写进结果快照的那一帧被按下出口。
   *
   * ## 为什么一律 replace，不 push
   *
   * 清 sessionStorage 只清掉了「下一位进 /scan 会复水到哪一屏」。**历史条目本身还在**：
   * push 之后 `/scan?stage=result` 仍是浏览器历史里的一条，它带着当时那笔 `location.state`
   * （结果页的 `file` 与 `scanType` 会经由 `ScanProgressPage.finishWithResult` 的
   * 非工作台路径写进去），而结果页取数是 `stored?.result?.file ?? locationState.file` ——
   * 存储清了，路由 state 还能把上一位那份文件名与签名内容链接补回来。
   * 一体机没有可见的后退键，但 Kiosk 浏览器的手势/外设、以及隐私清场自己的
   * back/forward 编排都能走到这条历史条目上。
   *
   * replace 把**这一条**直接换成落点：
   *   · 后退：越过整条扫描流程，落在进 /scan 之前那一页，永远回不到结果屏；
   *   · 前进：那条结果条目已经不存在，前进也无从复现。
   * 落点照样立即能用这份文件（这是「保留落点立即可用文件」的要求）：解析页那一条历史
   * 带着 `fileId`；打印台读的是离开前写好的打印材料会话（见 handlePrint）。
   * 它们由各自页面的生命周期与隐私边界管，不在本页职责内。
   */
  const leaveScanFlow = (destination: string, options?: NavigateOptions): void => {
    revokeLiveScanSession(getToken())
    clearScanWorkbenchSession()
    navigate(destination, { ...options, replace: true })
  }

  /* ── 成功页那三个去向也是「离开整条扫描流程」 ──────────────────────────────
   *
   * 打印（当时叫「直接打印」）/ AI 简历识别 / 前往我的文档，此前都是裸 navigate：本机登记原封不动留在
   * sessionStorage 里 —— 里面有上一位的 `live.controlToken` 明文，还有
   * `result.file`（文件名 + 那条签名内容链接）。下一位在这台机器上进 /scan，
   * 阶段直接从登记复水到 result，他看到的是**上一位的扫描件**。
   *
   * 所以三个都走 leaveScanFlow：撤服务端任务（已终态时是 no-op）→ 清本机登记 →
   * 带着文件跳过去。解析页读路由 state（`state.fileId`），打印台读打印材料会话，
   * 都不读扫描登记，所以清掉登记不影响它们拿到这份文件。 */

  /**
   * 「拿去打印」：扫描件是用户本人原件（resume_scan / id_scan / print_doc · original）。
   * 生产强制 PRINT_REQUIRE_PII_SCAN=true，没做完隐私检查就建单会被拒 PRINT_PII_SCAN_REQUIRED，
   * 而隐私检查只在打印台的材料检查里做 —— 所以去材料检查，不直达报价确认页（商用收口 P0-5）。
   *
   * 写法与打印上传页相同：先把这份扫描件**整份**写进打印交接上下文（旧文件的检查结论、参数一并作废），
   * 再离开（撤服务端扫描任务、清本机登记），跳转只带交接编号，打印台只认上下文。
   */
  const handlePrint = () => {
    if (!file) return
    const printFile = { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, pages: file.pages, mimeType: file.mimeType }
    const source: PrintMaterialSource = scanType === 'resume' ? 'resume' : 'document'
    const target = printHandoffTarget(beginPrintHandoff({ origin: 'scan_result', file: printFile, source,
      returnPath: '/scan', idDocument: scanType === 'id' }, printOwner))
    leaveScanFlow(target.path, { state: target.state })
  }

  const handleDocuments = () => {
    if (!file || !isLoggedIn) return
    leaveScanFlow('/me/documents')
  }

  const handleResumeAI = () => {
    if (!file) return
    leaveScanFlow('/resume/parse', {
      state: {
        source: 'scan',
        // ResumeParsePage 只读顶层 state.fileId 发起解析请求，file 内的 fileId/fileUrl
        // 仅用于展示；与 ResumeSourcePage 的既有上传流程保持同一 state 契约。
        fileId: file.fileId,
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, format: file.format },
      },
    })
  }

  return { leaveScanFlow, handlePrint, handleDocuments, handleResumeAI }
}
