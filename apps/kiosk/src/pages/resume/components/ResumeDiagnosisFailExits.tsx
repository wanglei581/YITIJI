// ============================================================
// 简历诊断**明确失败**态的非 AI 出路（稿 22 diagnose-failed 的 `.exits` 卡与自查清单）。
//
// 改动前这一屏只有「返回首页 / 重新解析」两个按钮：文件已经好好地传到服务端了，
// 用户却在一台打印终端上一张纸也拿不走，只能反复重试同一个挂掉的 AI。
// 「返回首页 / 重新解析」现在在报告页的青序操作条里；这里只放不需要 AI 的出路。
//
// 三条硬约束：
//   1. 不伪造：这里一条 AI 结论都不给。诊断没跑出来就是没有，不拿通用建议顶替。
//   2. 出路必须是真的：打印原件带着上传结果的 fileId 与真实 HMAC content URL 进打印台材料检查。
//      这是用户自己的原件（resume_upload / resume_scan · original），生产强制
//      PRINT_REQUIRE_PII_SCAN=true，没做完隐私检查就建单会被拒 —— 所以不直达报价确认页
//      （商用收口 P0-5）。拿不到 fileId 或打印链接时按钮如实置灰并写明原因。
//   3. 置灰一律 aria-disabled，不用原生 disabled ——
//      原生 disabled 会退出 Tab 序列、读屏跳过，触屏也没有 hover 读不到 title。
// 样式：触屏版出路行（ExitRow，可点 ≥64px）与自查清单，页面样式在 touch/report.css。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { useStartPrintHandoff } from '../../print/usePrintHandoff'
import { ExitRow, ManualChecks } from './resume-report/ResumeReportExits'

export interface ResumeDiagnosisFailFile {
  name: string
  size: string
  format: string
  /** kiosk-upload 下发的 HMAC content URL（30 分钟 TTL）。刷新丢 state 后为空。 */
  fileUrl?: string
  mimeType?: string
}

interface Props {
  file?: ResumeDiagnosisFailFile
  /** 上传结果的 fileId（来源页放在解析页 state 顶层，失败时随整份 state 转到报告页）。刷新丢 state 后为空。 */
  fileId?: string
}

/** 拿不到这份原件时的真实原因。写在按钮旁边常驻可见，不放 tooltip。 */
const NO_PRINT_URL_REASON =
  '这里拿不到你刚上传的那份原件（离开这一页再回来就拿不到了）。请回到简历来源重新选取文件，再去打印。'

export function ResumeDiagnosisFailExits({ file, fileId }: Props) {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const canPrintOriginal = Boolean(fileId && file?.fileUrl)

  const printOriginal = () => {
    if (!file?.fileUrl) return
    if (!fileId) return
    // 写法与打印上传页相同：先整份写打印交接上下文（旧文件的检查结论、参数一并作废），再去材料检查。
    // 跳转只带交接编号，打印台只认上下文。
    const printFile = {
      name: file.name,
      size: file.size,
      pages: null,
      fileId,
      fileUrl: file.fileUrl,
      mimeType: file.mimeType,
    }
    startPrint({ origin: 'resume_original', file: printFile, source: 'resume', returnPath: window.location.pathname })
  }

  return (
    <>
      <div className="qxt-sec">这些都不需要 AI<small>现在就能做</small></div>
      <div className="qxt-exit-col rrp-exits resume-report-fail-exits" data-testid="resume-report-fail-exits">
        {canPrintOriginal ? (
          <ExitRow icon="printer" title="打印我上传的原件" desc="不需要 AI，先检查个人信息再打印" take="去核对" route="/print/material-check" index={0} onClick={printOriginal} />
        ) : (
          <div>
            {/*
              真 <button> + aria-disabled，不加原生 disabled：
              置灰的按钮也必须能被 Tab 到、被读屏读到，并且读得到「为什么点不动」。
              这里刻意不绑 onClick，按下去不会有任何副作用。
            */}
            <ExitRow icon="printer" title="打印我上传的原件" desc="本次不可用" disabled describedBy="resume-fail-print-reason" index={0} />
            <p id="resume-fail-print-reason" className="qxt-reason-note">{NO_PRINT_URL_REASON}</p>
          </div>
        )}
        <ExitRow icon="printer" title="去打印 / 扫描其他材料" desc="打印扫描不依赖 AI，照常可用" take="去打印扫描" route="/print-scan" index={1} onClick={() => navigate('/print-scan')} />
        <ExitRow icon="book" title="查政策" desc="查看本机构发布的政策与办理说明" take="去看政策" route="/policy-service" index={2} onClick={() => navigate('/policy-service')} />
        <ExitRow icon="qr" title="本机构官方渠道" desc="扫码查看本机构官网或官方账号" take="去扫码" route="/official-channels" index={3} onClick={() => navigate('/official-channels')} />
      </div>
      <ManualChecks delay={5} />
    </>
  )
}
