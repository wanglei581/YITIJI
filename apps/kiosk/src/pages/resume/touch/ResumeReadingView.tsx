import type { ReactNode } from 'react'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { ResumePaperArt } from './ResumeTouchArt'
import './reading.css'

/**
 * 读简历（稿 reading）：左边是简历小样，右边是「在进行」、四条处理内容说明、将评估的六个维度和两句声明。
 * 小样与圆圈只表示在进行，不表示百分比；四条说明不打勾、不报阶段。
 * 运行页原有的游客声明、识别不清怎么办放在左栏小样与文件名下面（右栏只留稿里的内容，不会被挤出卡片）；
 * 结果未知 / 失败时把「在进行」换成对应的说明，结果未知的几段说明放在右栏，恢复动作由页面放进底栏主按钮。
 */
export function ResumeReadingView({
  outcome,
  title,
  fileName,
  fileCaption,
  steps,
  dimensions,
  notes,
  unknownNote,
}: {
  outcome: 'failed' | 'unknown' | null
  /** 「在进行」那一格的标题；等待时写「在进行」，失败 / 未知时写对应说明。 */
  title: string
  fileName: string
  fileCaption: string | null
  steps: ReadonlyArray<{ key: string; label: string; hint: string }>
  dimensions: readonly string[]
  /** 两句声明之外还要说的话（游客声明、识别不清时怎么办、开发键），放在左栏文件名下面。 */
  notes: ReactNode
  unknownNote: ReactNode
}) {
  const stepList = (
    <>
      <div className="qxt-h">处理内容</div>
      <ol className="qxt-steps4" aria-label="本次处理内容说明">
        {steps.map((step, index) => (
          <li key={step.key} className="qxt-step4">
            <i aria-hidden="true">{index + 1}</i>
            <span><b>{step.label}</b><small>{step.hint}</small></span>
          </li>
        ))}
      </ol>
    </>
  )
  const dimList = (
    <section className="qxt-dimro">
      <b>报告将评估的维度</b>
      <div className="qxt-rochips">
        {dimensions.map((item) => <span key={item}>{item}</span>)}
      </div>
    </section>
  )
  const whys = (
    <>
      <p className="qxt-why"><QxTouchIcon name="shield" size={28} strokeWidth={2} /><span>返回仅停止本机等待，不会撤回已提交的服务请求。简历原文不会发送给企业，也不进入平台候选人简历库。</span></p>
      <p className="qxt-why"><QxTouchIcon name="shield" size={28} strokeWidth={2} /><span>发给 AI 之前会先遮住手机号、身份证号、邮箱、住址等个人信息。</span></p>
    </>
  )
  return (
    <div className="qxt-readgrid">
      <div className="qxt-reader">
        <ResumePaperArt width={520} state="plain" shadow={false} />
        <p className="qxt-reader-cap"><b>{fileName}</b>{fileCaption ? <small>{fileCaption}</small> : null}</p>
        <div className="qxt-reader-notes">{notes}</div>
      </div>
      <div className="qxt-rcol">
        <div className="qxt-live" role="status" aria-live="polite" data-tone={outcome ?? 'running'}>
          {outcome ? <QxTouchIcon name="alert" size={40} strokeWidth={2} /> : <span className="qxt-spin" aria-hidden="true" />}
          <div>
            <b>{title}</b>
            <small>以下是这次要处理的内容，不代表实时进度</small>
          </div>
        </div>
        {outcome === 'unknown' ? unknownNote : null}
        {outcome ? <>{whys}{stepList}</> : <>{stepList}{dimList}{whys}</>}
      </div>
    </div>
  )
}
