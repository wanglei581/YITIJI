/** 没有任务时的出路，版式对齐状态样式板的空态（稿 st-empty）：顺序、去选文件、我的文档。 */

import { QxTouchStateEmpty } from '../../../components/qingxu/touch/QxTouchStates'
import { PrintArt } from '../art/PrintArt'

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
    <QxTouchStateEmpty
      howto="文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。"
      stepsTitle="办理顺序"
      steps={[...STEPS]}
      slabs={[
        { title: '去选文件', desc: '手机、U 盘，把真实文件带进这次办理', onClick: onUpload, visual: <PrintArt name="phone" size={86} /> },
        { title: '我的文档（登录后）', desc: '登录后才能看到你保存的文件', onClick: onDocuments, visual: <PrintArt name="stack" size={100} count={2} /> },
      ]}
      fine={note}
    />
  )
}
