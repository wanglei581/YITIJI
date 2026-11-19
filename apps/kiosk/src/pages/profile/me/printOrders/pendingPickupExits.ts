/**
 * 还没有打印任务时，待取单块下面接两张出路卡。
 * 读失败且下面没有打印任务时也接这两张，不留整屏空白。
 * 第二张去「我的文档」，不再和上面那行重复「输到机码取件」。
 * 小程序未发布时第二张仍是「看看我的文档」。
 */

export interface PendingPickupExitCard {
  title: string
  desc: string
  to: '/print-scan' | '/print/pickup-claim' | '/me/documents'
  art: 'usb' | 'phone' | 'stack'
  artWidth: number
  /** 去打印受执照收口。去我的文档、看看我的文档不受。 */
  locked: boolean
}

/** 读失败时的两句。没有打印任务时不写「下面…不受影响」。 */
export function pendingPickupErrorLines(hasTasks: boolean): readonly string[] {
  const lead = '手机上还没取的单这次没读到。'
  if (!hasTasks) return [lead]
  return [lead, '下面已产生打印任务的订单不受影响。']
}

/** 左文件类型块：材料包用图层，单份文件用扩展名。打码后的名字仍能取出扩展名。 */
export function pendingPickupFileMark(label: string): { pkg: boolean; text: string } {
  if (label.startsWith('材料包')) return { pkg: true, text: '' }
  const dot = label.lastIndexOf('.')
  const ext = dot > 0 ? label.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '') : ''
  return { pkg: false, text: (ext || '文件').slice(0, 4).toUpperCase() }
}

export function pendingPickupExitCards(input: {
  printTaskCount: number
  presence: 'off' | 'loading' | 'hidden' | 'rows' | 'error'
  miniOn: boolean
}): PendingPickupExitCard[] {
  if (input.printTaskCount !== 0) return []
  if (input.presence !== 'rows' && input.presence !== 'error') return []
  const printCard: PendingPickupExitCard = {
    title: '去打印',
    desc: 'U 盘、手机或扫描都可以',
    to: '/print-scan',
    art: 'usb',
    artWidth: 200,
    locked: true,
  }
  const second: PendingPickupExitCard = input.miniOn
    ? {
        title: '去我的文档',
        desc: '从已保存的文件里再选一份',
        to: '/me/documents',
        art: 'stack',
        artWidth: 170,
        locked: false,
      }
    : {
        title: '看看我的文档',
        desc: '选一份已保存的文件再打',
        to: '/me/documents',
        art: 'stack',
        artWidth: 170,
        locked: false,
      }
  return [printCard, second]
}
