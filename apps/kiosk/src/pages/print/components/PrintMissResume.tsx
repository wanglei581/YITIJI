/** 没有任务 / 没有文件时的出路，版式对齐状态样式板的空态（稿 st-empty）：顺序、去选文件、我的文档。 */

import { QxTouchStateEmpty } from '../../../components/qingxu/touch/QxTouchStates'
import { useAuth } from '../../../auth/useAuth'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { PrintArt } from '../art/PrintArt'
import { usePickPrintDocuments } from '../usePickPrintDocuments'
import { missResumeDocumentsDesc, missResumeFine, missResumeHowto } from './printMissResumeCopy'

const STEPS = ['选文件', '材料检查', '预览与参数', '核对价格'] as const

export function PrintMissResume({
  onUpload,
  note,
  orderMayExist,
}: {
  onUpload: () => void
  note: string
  /**
   * 这一页是不是可能已经有订单。必传，没有默认值：
   * 付款之前的空态（材料检查、预览）传 false，才能说「没有订单，也没有扣费」；
   * 出纸页、完成页拿不到任务信息时订单很可能已建、已付，传 true，页面不下「没有订单」的结论。
   */
  orderMayExist: boolean
}) {
  const { isLoggedIn } = useAuth()
  const support = useSupportContact()
  const openDocuments = usePickPrintDocuments()
  return (
    <QxTouchStateEmpty
      howto={missResumeHowto(orderMayExist)}
      stepsTitle="办理顺序"
      steps={[...STEPS]}
      slabs={[
        { title: '去选文件', desc: '手机、U 盘，把真实文件带进这次办理', onClick: onUpload, visual: <PrintArt name="phone" size={86} /> },
        { title: '我的文档（登录后）', desc: missResumeDocumentsDesc(isLoggedIn), onClick: openDocuments, visual: <PrintArt name="stack" size={100} count={2} /> },
      ]}
      fine={missResumeFine(orderMayExist, note, support)}
    />
  )
}
