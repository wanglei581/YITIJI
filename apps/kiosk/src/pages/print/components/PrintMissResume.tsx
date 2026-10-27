/** 没有任务时的出路，版式对齐状态样式板的空态：顺序、去选文件、我的文档。 */

const STEPS = ['选文件', '材料检查', '预览与参数', '核对价格'] as const

export function PrintMissResume({
  onUpload,
  onDocuments,
  note,
}: {
  onUpload: () => void
  onDocuments: () => void
  note: string
}) {
  return (
    <>
      <p className="pfp-miss-lead">文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。</p>
      <div className="pfp-miss-kicker">办理顺序</div>
      {STEPS.map((label, index) => (
        <div className="pfp-miss-step" key={label}>
          <b>{index + 1}</b>
          <span>{label}</span>
        </div>
      ))}
      <button type="button" className="pfp-miss-go" onClick={onUpload}>
        <b>去选文件</b>
        <span>手机、U 盘，把真实文件带进这次办理</span>
      </button>
      <button type="button" className="pfp-miss-go" onClick={onDocuments}>
        <b>我的文档</b>
        <span>登录后才能看到你保存的文件</span>
      </button>
      <p className="pfp-miss-note">{note}</p>
    </>
  )
}
