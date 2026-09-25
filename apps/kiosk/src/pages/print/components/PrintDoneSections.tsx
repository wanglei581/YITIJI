// ============================================================
// PrintDoneSections —— /print/done（稿 15-print-fulfill）的结果态纯展示分区
//
// 只收 PrintDonePage 已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额。
//   PrintDoneXq            小青区（稿 .xq）：各结果态的首句与「你现在该干嘛」
//   PrintFeeBoundaryBar    「费用与订单边界」内联条（稿 moneyBar）：费用说明态使用
//   PrintJobSummaryCard    完成态「本次任务摘要」
//
// 结果判定（completed / failed / errorCode 分态）、带走链接、重试与清场仍在页面里，门禁按页面文件取证。
// 本文件渲染在完成页上，守同一套文案红线：不写「已支付」（用「已付」）、不出现退款 / 赔付字样。
// ============================================================

import type { ReactNode } from 'react'
import { FileTextIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'

const DUPLEX_LABEL: Record<string, string> = {
  simplex:           '单面',
  duplex_long_edge:  '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

export function PrintDoneXq({ ask, doing, mainClassName }: {
  ask: ReactNode
  doing: ReactNode
  /** 稿 15 一屏骨架（.pfp-page）里文字列要吃满余宽；其余结果态保持原排版。 */
  mainClassName?: string
}) {
  return (
    <section className="pff-xq">
      <div className="pff-xq-row">
        <div className="pff-xq-face" aria-hidden="true">青</div>
        <div className={mainClassName}>
          <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
          <p className="pff-xq-ask">{ask}</p>
          <p className="pff-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

/** 稿 moneyBar：只写订单本身的确定事实 + 由谁裁决，不承诺补打、费用处理或到账。 */
export function PrintFeeBoundaryBar({ sub, body, facts }: {
  sub: string
  body: ReactNode
  facts: ReactNode
}) {
  return (
    <div className="pff-inbar">
      <div className="pff-inbar-h">
        <span className="pff-inbar-ic"><FileTextIcon aria-hidden="true" /></span>
        <span>费用与订单边界<small>{sub}</small></span>
      </div>
      <p className="pff-inbar-b">{body}</p>
      <div className="pff-inbar-kv">{facts}</div>
    </div>
  )
}

export function PrintJobSummaryCard({ file, params }: {
  file: { name: string; pages: number }
  params: PrintJobParams
}) {
  return (
    <div className="qx-card">
      <b className="pff-info-hd">本次任务摘要</b>
      <div className="pff-i-row"><span className="pff-i-k">文件名</span><span className="pff-i-v">{file.name}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">页数 / 份数</span><span className="pff-i-v">{file.pages} 页 × {params.copies} 份</span></div>
      <div className="pff-i-row"><span className="pff-i-k">打印面</span><span className="pff-i-v">{DUPLEX_LABEL[params.duplex] ?? params.duplex}</span></div>
      <div className="pff-i-row">
        <span className="pff-i-k">色彩 / 质量</span>
        <span className="pff-i-v">
          {params.colorMode === 'color' ? '彩色' : '黑白'} · {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
        </span>
      </div>
    </div>
  )
}
