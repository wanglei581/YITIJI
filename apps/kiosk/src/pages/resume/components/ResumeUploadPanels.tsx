import type { ReactNode } from 'react'

interface ResumeUploadPanelsProps {
  error: string | null
  uploadUnknown: boolean
  uploadRecheck: boolean
  uploading: boolean
  signedIn: boolean
  pendingName: string | null
  helpLine: string
}

/**
 * 上传进行中、已知失败、结果未知、再查之后。
 * 结果未知没有可查询的上传记录，再查按钮只把这一步说清楚，不会再发一次上传。
 */
export function ResumeUploadPanels({
  error, uploadUnknown, uploadRecheck, uploading, signedIn, pendingName, helpLine,
}: ResumeUploadPanelsProps) {
  if (uploading) {
    return (
      <section className="qx-rt-block" data-testid="resume-uploading" aria-label="正在上传">
        <h2 className="qx-rt-sec-h">正在上传 <small>{pendingName || '这一份'}</small></h2>
        <p className="qx-rt-note resume-source-status" role="status">
          <b>上传中</b>这一次正在传。这里不显示进度条，也没有取消。离开这一页不会撤回已经发出的传输。
        </p>
        <ol className="qx-rt-steps" aria-label="上传时要注意的">
          <li><i aria-hidden="true">1</i><strong>来源先别断开</strong><em>U 盘别拔，本机文件别中途挪走</em><span>需要你注意</span></li>
          <li><i aria-hidden="true">2</i><strong>这一步不能取消</strong><em>传出去之后没有可以叫停的开关</em><span>机器这样</span></li>
          <li><i aria-hidden="true">3</i><strong>传完还要你确认</strong><em>成功之后才进入下一步，不会直接开始诊断</em><span>机器这样</span></li>
        </ol>
        <p className="qx-rt-hint" data-testid="resume-help-line">{helpLine}</p>
      </section>
    )
  }
  if (uploadRecheck) {
    return (
      <section className="qx-rt-block" data-testid="resume-upload-recheck" aria-label="再查刚才这一次">
        <h2 className="qx-rt-sec-h">没有可以再查的记录</h2>
        <p className="qx-rt-note" data-tone="warn" role="status">
          <b>没有再传一次</b>刚才那次上传没有留下可以查询的记录，这台机器查不到它成功没有，也没有把文件再发一遍。
        </p>
        <Facts name={pendingName} />
        <p className="qx-rt-hint" data-testid="resume-help-line">{helpLine}</p>
      </section>
    )
  }
  if (uploadUnknown) {
    return (
      <section className="qx-rt-block" aria-label="上传结果未知">
        <h2 className="qx-rt-sec-h">这一份的状态 <small>结果未知</small></h2>
        {pendingName ? <p className="qx-rt-hint">刚才选的是：{pendingName}</p> : null}
        <p className="qx-rt-note resume-source-unknown" data-tone="warn" role="status">
          <b>结果未知</b>暂时无法确认这一份有没有传上去。本页不会自动再传，也不会用之前那份文件继续。
        </p>
        <dl className="qx-rt-kv">
          <div><dt>现在确定的</dt><dd>这台机器没有拿到这一次的结果。</dd></div>
          <div><dt>现在不确定的</dt><dd>这份文件可能已经传上去了，也可能没有。</dd></div>
          <div><dt>再查的是</dt><dd>只核对刚才这一次，不会另起一次上传。</dd></div>
          <div><dt>为什么不重发</dt><dd>再发一次可能变成两份文件，所以这里没有重新上传。</dd></div>
          <div>
            <dt>建议这样做</dt>
            <dd data-testid="resume-source-unknown-next">
              {signedIn
                ? '可以稍后到「我的 → 我的文档」看有没有多出一份。这一步不会再传一次。'
                : '当前未登录，暂时无法核对账号记录。这一步不会再传一次。可以换一种来源，或先离开。'}
            </dd>
          </div>
        </dl>
      </section>
    )
  }
  if (error) {
    return (
      <section className="qx-rt-block" aria-label="上传失败">
        <h2 className="qx-rt-sec-h">上传失败 <small>{pendingName || '这一份'}</small></h2>
        <p className="qx-rt-note resume-source-error" data-tone="error" role="alert">{error}</p>
        <p className="qx-rt-hint">系统没有收到完整文件。可以重试这一份，也可以换一份文件。</p>
      </section>
    )
  }
  return null
}

function Facts({ name }: { name: string | null }): ReactNode {
  return (
    <dl className="qx-rt-kv">
      <div><dt>刚才那一份</dt><dd>{name || '文件名没有留下来'}</dd></div>
      <div><dt>这一步做了什么</dt><dd>没有再发上传，也没有拿到新的结果。</dd></div>
    </dl>
  )
}
