import { PrintArt, type PrintArtName } from './PrintArt'

/**
 * 页面里内容不够高的状态屏（空、读取中、失败、已完成）用一块实物小样吃掉剩下的高度，
 * 不留成整块空白。纯装饰，读屏跳过；内容够长时它自己缩到 0，不挤任何东西。
 * 小样只画「这件事在办的东西」（手机、U 盘、纸），不画成有结果的样子，也不当订单预览。
 */
export function PrintFillArt({ name, className }: { name: PrintArtName; className?: string }) {
  return (
    <div className={['pfa', className].filter(Boolean).join(' ')} aria-hidden="true" data-fill-art={name}>
      <PrintArt name={name} size={520} crop={{ x: 0.07, top: 0.015, bottom: 0.09 }} />
    </div>
  )
}
