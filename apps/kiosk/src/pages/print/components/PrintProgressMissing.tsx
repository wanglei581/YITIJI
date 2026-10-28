// 出纸页没有任务可看的两种情形（稿 st-empty 的版式）：
//   no-context   路由里没有任务信息：未找到打印任务，从上传文件重新开始
//   not-created  http 模式下没有真实 taskId：打印任务尚未创建，返回确认页重试
// 两种都不编造进度或出纸结果；页面不知道订单有没有建、付没付，所以出路里不下「没有订单」的结论（见 PrintMissResume）。
// 底栏用触屏三槽（返回首页 / 问小青 / 主按钮），不再传旧的 ctabar。

import { AlertCircleIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PrintTouchFrame, printAsk } from '../PrintTouchFrame'
import { PrintFillArt } from '../art/PrintFillArt'
import { PrintMissResume } from './PrintMissResume'

export function PrintProgressMissing({ variant, uploadPath, confirmState }: {
  variant: 'no-context' | 'not-created'
  uploadPath: string
  /** 返回确认页时带回去的路由 state。 */
  confirmState: unknown
}) {
  const navigate = useNavigate()
  const notCreated = variant === 'not-created'
  return (
    <PrintTouchFrame
      page="print-progress"
      legacyBody={false}
      /* 稿 15-print-fulfill 原文：aria-label="返回首页"。
       *  返回 ≠ 取消：打印任务在服务端，离开这一屏不会终止它，
       *  用户可以从「我的打印订单」再回来看进度。 */
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title={notCreated ? '打印任务尚未创建' : '未找到打印任务'}
      subtitle={notCreated ? '请返回确认页重试' : '请从上传文件重新开始打印流程'}
      status={{ tone: 'unknown', label: '状态未知' }}
      terminalLabel="就业服务大厅"
      ask={notCreated
        ? printAsk('问小青：现在怎么办', '打印任务还没有创建，我现在能做什么？请告诉我下一步，不要假装已经出纸，也不要替我判断有没有扣费。')
        : printAsk('问小青：文件要从哪传？', '这一页没有待处理的打印任务。请说明文件可以从哪里传上来。不要假装已经有打印任务或订单。')}
      primary={notCreated
        ? { label: '返回确认页', onClick: () => navigate('/print/confirm', { state: confirmState }) }
        : { label: '重新上传文件', onClick: () => navigate(uploadPath) }}
      nav
    >
      <div data-w2-page="print-progress" data-print-flow-step={6} data-testid="print-fulfill-state-missing-context" className="qx-scroll pff-page pfp-miss">
        <div className="qx-state" data-tone={notCreated ? 'error' : 'empty'}>
          <span className="qx-state-ic"><AlertCircleIcon aria-hidden="true" /></span>
          <div>
            <div className="qx-state-t">{notCreated ? '打印任务尚未创建' : '未找到打印任务'}</div>
            <div className="qx-state-d">
              {notCreated
                ? '没有真实 taskId，不能展示打印进度，也不会假装已经出纸。'
                : '请从上传文件重新开始打印流程。本页不会编造进度或打印结果。'}
            </div>
          </div>
        </div>
        <PrintMissResume
          orderMayExist
          onUpload={() => navigate(uploadPath)}
          note={notCreated
            ? '没有真实任务编号，这一页不会假装已经出纸。'
            : '这一页本身不保存文件，也不会编造进度或打印结果。'}
        />
        <PrintFillArt name="stack" />
      </div>
    </PrintTouchFrame>
  )
}
