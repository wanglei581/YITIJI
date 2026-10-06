import type { ReactNode } from 'react'
import type { GeneratePreviewViewState } from './resume-deliver/constants'
import { ResumeGenerateHelpLine } from './ResumeGenerateShell'

const REFILL = [
  { title: '基本信息', detail: '姓名必填，城市和联系方式点候选词就行', mark: '第 1 步' },
  { title: '求职意向', detail: '目标岗位必填，城市、类型、薪资都能点选', mark: '第 2 步' },
  { title: '经历', detail: '教育、工作、项目三类，都可以空着；描述能直接说', mark: '第 3 步' },
  { title: '技能与自评', detail: '只填你真有的，写一两句就够', mark: '第 4 步' },
] as const

function Box({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="qx-rg-statebox" role="status">
      <b>{title}</b>
      <p>{body}</p>
    </div>
  )
}

function Minis({ left, right }: { left: { title: string; body: ReactNode }; right: { title: string; body: ReactNode } }) {
  return (
    <div className="qx-rd-notes">
      <div className="qx-card"><b>{left.title}</b><p>{left.body}</p></div>
      <div className="qx-card"><b>{right.title}</b><p>{right.body}</p></div>
    </div>
  )
}

/** 四个没有生成结果的屏各自成文。不挂「AI 生成」标识。 */
export function ResumeGeneratePreviewEmpty(props: { view: GeneratePreviewViewState; withTask: boolean }) {
  if (props.view === 'session-lost') {
    return (
      <div className="qx-card qx-rg-empty-card" data-testid="resume-generate-preview-session-lost">
        <div className="qx-rd-heading">
          <b>已填内容已经清除</b>
          <span className="qx-rg-hint">公共设备的设计如此</span>
        </div>
        <Box
          title="这一份要从头填"
          body={<>填写内容只放在这台机器的内存里，<b>刷新、返回、待机或超时之后就没了</b>，也不会写进本机存储。这是公共一体机的隐私设计，<b>不是出故障</b>。{props.withTask ? '这个地址还带了一条记录标识，但没有凭证也读不回来。' : null}</>}
        />
        <div className="qx-rg-chiphead">重新填只要<b>四步</b><span>只有姓名和目标岗位必填</span></div>
        <ol className="qx-rg-refill" data-testid="resume-generate-preview-refill-steps">
          {REFILL.map((row) => (
            <li key={row.title}>
              <b>{row.title}</b>
              <span>{row.detail}</span>
              <em>{row.mark}</em>
            </li>
          ))}
        </ol>
        <ResumeGenerateHelpLine />
      </div>
    )
  }
  if (props.view === 'preview-no-result') {
    return (
      <div className="qx-card qx-rg-empty-card">
        <div className="qx-rd-heading">
          <b>没有可预览的结果</b>
          <span className="qx-rg-hint">不会拿示例冒充</span>
        </div>
        <Box
          title="这次进来没有带结果"
          body={props.withTask
            ? <>预览要有一次<b>已经完成的生成</b>才能显示。这个地址带了一条记录标识，没有凭证读不回来，所以这一页<b>不显示任何简历内容</b>，也不会拿示例冒充你的简历。</>
            : <>这次没有带结果，所以这一页<b>不显示任何简历内容</b>，也不会拿示例冒充你的简历。</>}
        />
        <Minis
          left={{ title: '两种进得来的方式', body: <>一是刚提交完、结果直接带过来；二是登录后从「我的简历」点进来。<b>直接敲地址进不来。</b></> }}
          right={{ title: '为什么不先放点什么', body: <>放一份示例在这里，你会以为那是你的简历。<b>宁可这一屏是空的</b>，也不放一份不属于你的内容。</> }}
        />
        <ResumeGenerateHelpLine />
      </div>
    )
  }
  if (props.view === 'preview-failed') {
    return (
      <div className="qx-card qx-rg-empty-card">
        <div className="qx-rd-heading">
          <b>这条记录没读回来</b>
          <span className="qx-rg-hint">不拿别的结果凑数</span>
        </div>
        <Box
          title="读不回这次的生成结果"
          body={<>可能已经过了留存期、这条不属于当前登录的人，或者网络不通。<b>页面不会退而求其次</b>显示另一份结果，也<b>不会用示例填满</b>这一屏。</>}
        />
        <Minis
          left={{ title: '可能是过了留存期', body: <>生成结果按保存期限清理，到期是真的没有了。这一页<b>不会假装还留着一份</b>。</> }}
          right={{ title: '也可能不是本人', body: <>结果只认你的登录身份或那次提交的一次性令牌。换个人、换个账号，一律当它不存在。</> }}
        />
        <ResumeGenerateHelpLine />
      </div>
    )
  }
  if (props.view === 'illegal') {
    return (
      <div className="qx-card qx-rg-empty-card">
        <div className="qx-rd-heading">
          <b>认不出这个页面状态</b>
          <span className="qx-rg-hint">不回显原始参数</span>
        </div>
        <Box
          title="地址里的状态没有登记"
          body={<>这一页只认自己登记过的状态。收到没登记的值时，<b>不猜你想去哪一步</b>，也<b>不把地址里的原始参数显示在屏幕上</b>。地址被改过、扫到旧二维码，或者从一个已经改版的入口跳过来，都不会丢东西，只是这一屏认不出来。</>}
        />
        <Minis
          left={{ title: '不会丢东西', body: <>只是这一屏认不出地址里的状态。你之前填的、生成的、导出的都不受这一屏影响。</> }}
          right={{ title: '为什么不猜一个', body: <>猜错一步，你可能以为自己在改这份简历，其实在改另一份。<b>认不出就停下来问你</b>。</> }}
        />
        <ResumeGenerateHelpLine />
      </div>
    )
  }
  return null
}
