import { InterviewShell } from '../InterviewShell'
import {
  InterviewCardHead,
  InterviewLoadingCard,
  InterviewNotice,
  InterviewOptList,
  InterviewRail,
  InterviewStatus,
  InterviewSteps,
} from '../interviewQxParts'
import '../interview-service-desk.css'
import '../styles/interview-workbench-qx.css'
import '../styles/interview-qx2.css'

/** 结束本场之后、报告返回之前。请求还在飞，不能把这一场说成还能继续答题。 */
export function InterviewReportPending({ onOpenTips, endedAtDeadline = false }: { onOpenTips: () => void; endedAtDeadline?: boolean }) {
  return (
    <InterviewShell
      title={<>本场结束后，<em>正在生成报告</em>。</>}
      subtitle="只有这场练习真正结束后才会请求报告。生成完成前不展示评分，也不把没返回的内容写成已经生成。"
      status={{ tone: 'unknown', label: '报告生成中' }}
      ctabar={
        <div className="interview-qx-cta">
          <div className="iv-cta-row">
            <button type="button" className="qx-btn" data-variant="ghost" onClick={onOpenTips}>
              查看面试技巧
            </button>
            <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" disabled>
              正在生成练习报告
            </button>
          </div>
        </div>
      }
    >
      <div
        data-kiosk-domain="interview"
        data-kiosk-screen="interview-session"
        data-qx-interview=""
        data-interview-state="report-pending"
        className="interview-flow interview-state-page"
        data-visual-theme="service-desk"
        data-ux-density="touch"
      >
        <div className="interview-flow__scroll">
          {endedAtDeadline && <InterviewNotice>练习时间到了，这一场已自动结束。报告只算到点前已经提交的回答。</InterviewNotice>}
          <InterviewStatus
            label="报告生成状态"
            items={[
              { k: '本场作答', v: '已结束', tone: 'ok' },
              { k: '练习报告', v: '生成中' },
              { k: '评分与录用判断', v: '不提供' },
            ]}
          />
          <InterviewLoadingCard label="正在请求本场练习报告" />
          <section className="iv-card">
            <InterviewCardHead title="报告只归纳这些" hint="来自本场已确认作答" />
            <InterviewSteps rows={[
              ['会写', '你确认过的回答', '缺失的题不会被补造。'],
              ['不写', '录用与通过率', '不预测结果，也不给企业推荐。'],
              ['不写', '语速语调评价', '只按文本内容做复盘。'],
            ]} />
          </section>
          <section className="iv-card">
            <InterviewCardHead title="等待时可以先做" hint="不影响本次生成" />
            <InterviewOptList
              rows={[{
                k: '技',
                title: '查看公开面试技巧',
                desc: '准备清单与 STAR 方法随时可读。报告请求仍会继续。',
                onClick: onOpenTips,
              }]}
            />
            <p className="iv-copy">这一场已经在收报告。请求还没返回时，不能把它说成还能继续答题。</p>
          </section>
          {!endedAtDeadline && <InterviewNotice>
            生成失败时会回到作答页并写明原因。这里不展示固定评分，也不承诺报告已经保存。
          </InterviewNotice>}
          <InterviewRail />
        </div>
      </div>
    </InterviewShell>
  )
}
