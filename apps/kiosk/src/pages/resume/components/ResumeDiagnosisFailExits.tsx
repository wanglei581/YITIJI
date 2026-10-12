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
// 样式只用报告页既有的 rrp-exits / rrp-row / rrp-checks（resume-report-qx.css，行高 88px）。
// ============================================================

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpenIcon, ChevronRightIcon, QrCodeIcon, PrinterIcon } from 'lucide-react'
import { useStartPrintHandoff } from '../../print/usePrintHandoff'
import { MANUAL_CHECKS } from '../resume-report-model'

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

function RowIcon({ children }: { children: ReactNode }) {
  return <span className="rrp-ic" aria-hidden="true">{children}</span>
}

function RowGo() {
  return <span className="rrp-go" aria-hidden="true"><ChevronRightIcon size={22} /></span>
}

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
      <section className="rrp-exits resume-report-fail-exits" data-testid="resume-report-fail-exits">
        <div className="rrp-zh">这些都不需要 AI<span>现在就能做</span></div>
        <p className="rrp-export-reason" style={{ marginBottom: 12 }}>
          {file?.name ? `「${file.name}」的解析没有完成。` : '这次没有生成诊断报告。'}
        </p>
        {!canPrintOriginal ? (
          <p id="resume-fail-print-reason" className="rrp-export-reason" style={{ marginBottom: 12 }}>
            {NO_PRINT_URL_REASON}
          </p>
        ) : null}
        <div className="rows" style={{ display: 'grid', gap: 10 }}>
          {canPrintOriginal ? (
            <button type="button" className="rrp-row" onClick={printOriginal} data-route="/print/material-check">
              <RowIcon><PrinterIcon size={26} /></RowIcon>
              <span className="tx"><b>打印我上传的原件</b><span>不需要 AI，先检查个人信息再打印</span></span>
              <RowGo />
            </button>
          ) : (
            /*
              真 <button> + aria-disabled，不加原生 disabled：
              置灰的按钮也必须能被 Tab 到、被读屏读到，并且读得到「为什么点不动」。
              这里刻意不绑 onClick，按下去不会有任何副作用。
              原因放在网格外面：网格行会分掉余高，包一层 div 的话长高的是外层，按钮仍是矮的。
            */
            <button
              type="button"
              className="rrp-row"
              aria-disabled="true"
              aria-describedby="resume-fail-print-reason"
            >
              <RowIcon><PrinterIcon size={26} /></RowIcon>
              <span className="tx"><b>打印我上传的原件</b><span>本次不可用</span></span>
            </button>
          )}
          <button type="button" className="rrp-row" onClick={() => navigate('/print-scan')} data-route="/print-scan">
            <RowIcon><PrinterIcon size={26} /></RowIcon>
            <span className="tx"><b>去打印 / 扫描其他材料</b><span>打印扫描不依赖 AI，照常可用</span></span>
            <RowGo />
          </button>
          <button type="button" className="rrp-row" onClick={() => navigate('/policy-service')} data-route="/policy-service">
            <RowIcon><BookOpenIcon size={26} /></RowIcon>
            <span className="tx"><b>查政策</b><span>查看本机构发布的政策与办理说明</span></span>
            <RowGo />
          </button>
          <button type="button" className="rrp-row" onClick={() => navigate('/official-channels')} data-route="/official-channels">
            <RowIcon><QrCodeIcon size={26} /></RowIcon>
            <span className="tx"><b>本机构官方渠道</b><span>扫码查看本机构官网或官方账号</span></span>
            <RowGo />
          </button>
        </div>
      </section>
      <section className="rrp-checks" data-testid="resume-report-fallback">
        <div className="rrp-zh">不等 AI，先自己核一遍<span>6 项 · 纸质简历同样适用</span></div>
        <div className="list" data-testid="resume-report-list">
          {MANUAL_CHECKS.map((item, i) => (
            <div key={item}><i>{i + 1}</i><span>{item}</span></div>
          ))}
        </div>
      </section>
    </>
  )
}
