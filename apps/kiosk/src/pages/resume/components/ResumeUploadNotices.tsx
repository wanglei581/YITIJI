interface ResumeUploadNoticesProps {
  error: string | null
  uploadUnknown: boolean
  uploading: boolean
  signedIn: boolean
}

/** 上传失败、结果未知、上传中。结果未知不提供再查或重发按钮。 */
export function ResumeUploadNotices({ error, uploadUnknown, uploading, signedIn }: ResumeUploadNoticesProps) {
  return (
    <>
      {error ? <p className="qx-rt-note resume-source-error" data-tone="error" role="alert">{error}</p> : null}
      {uploadUnknown ? (
        <>
          <p className="qx-rt-note resume-source-unknown" data-tone="warn" role="status">
            <b>结果未知</b>暂时无法确认这一份有没有传上去。本页不会自动再传，也不会用之前那份文件继续。
          </p>
          <dl className="qx-rt-kv">
            <div><dt>发生了什么</dt><dd>上传过程中网络或服务出了问题，这台机器没能确认上传是否完成。</dd></div>
            <div><dt>还不确定的</dt><dd>这份文件可能已经传上去了，也可能没有。</dd></div>
            <div><dt>再传一次</dt><dd>可以重新选择文件再传；如果刚才那次其实已经传上去，会多出一份重复文件。</dd></div>
            <div>
              <dt>建议这样做</dt>
              <dd data-testid="resume-source-unknown-next">
                {signedIn
                  ? '可先到「我的 → 我的文档」核对；暂时没看到时可稍后刷新。若决定再传，请重新选择文件，可能出现重复文件。'
                  : '当前未登录，暂时无法核对账号记录。需要继续时，可重新选择文件或换一种来源。'}
              </dd>
            </div>
          </dl>
        </>
      ) : null}
      {uploading ? <p className="qx-rt-note resume-source-status" role="status">上传中，请稍候…</p> : null}
    </>
  )
}
