// 选文件页「没传上来 / 没读到」各出错屏的文案（稿 st-error）。纯函数：版式在 FileSourceError.tsx，
// 单测直接断言本文件。八种出错屏共用同一版式：文件卡（带「未收下」标，没有文件名的失败省掉）→ 原因卡 →
// 两张大出口卡 → 求助行；意图带眉题「打印文件 · 上传」、警示色状态胶囊、无「青」印章、底栏主键是真实的重试动作。
//
// 文案保留各自的真实原因：只写页面真的知道的事——系统有没有收到、当前文件是不是还是空的、能怎么重试。
// 不写「已收到」「已导入」之类没拿到确认的话；不出现「联系 / 找（现场）工作人员」。

import type { FileSourceScreen } from './fileSourceModel'

export const FILE_SOURCE_ERROR_SCREENS = [
  'local-rejected',
  'local-oversize',
  'local-unreadable',
  'local-upload-failed',
  'phone-gen-failed',
  'phone-confirm-failed',
  'usb-import-failed',
  'usb-read-failed',
] as const satisfies readonly FileSourceScreen[]

export type FileSourceErrorScreen = (typeof FILE_SOURCE_ERROR_SCREENS)[number]

export function isFileSourceErrorScreen(screen: FileSourceScreen): screen is FileSourceErrorScreen {
  return (FILE_SOURCE_ERROR_SCREENS as readonly string[]).includes(screen)
}

export type ErrorArt = 'phone' | 'usb' | 'stack'

export interface FileSourceErrorCopy {
  title: string
  subtitle: string
  /** 状态胶囊（警示色）。 */
  pill: string
  /** 文件卡右上角的标；没有文件卡时不用。 */
  chip: string
  reason: string
  /** 第一张出口卡：重试这一步（与底栏主键同一个动作）。 */
  retry: { title: string; desc: string; art: ErrorArt }
  /** 第二张出口卡：换一种办法。 */
  alt: { title: string; desc: string; art: ErrorArt }
  /** 原来就有「使用帮助」按钮的几屏，多出一行帮助入口。 */
  helpRow: boolean
  /** 底栏「问小青」：本屏专属问句。 */
  ask: { label: string; draft: string }
}

const NOT_RECEIVED = '不要假装已经收到这份文件。'

export function fileSourceErrorCopy(screen: FileSourceErrorScreen, options: { usbSwitchAllowed?: boolean } = {}): FileSourceErrorCopy {
  const usbOk = options.usbSwitchAllowed !== false
  switch (screen) {
    case 'local-oversize':
      return {
        title: '这份文件没传上来',
        subtitle: '单份超过上限，这一份没有被上传，系统没有收到。',
        pill: '没有收下',
        chip: '未收下',
        reason: '本机与 U 盘通道单份上限 15MB，这一份没有被上传。',
        retry: { title: '回窗口再挑一份', desc: '这一份没有收下。压缩后，或换一份小一点的再选一次', art: 'stack' },
        alt: { title: '换一种方式', desc: '改用手机扫码上传这份文件', art: 'phone' },
        helpRow: false,
        ask: { label: '问小青：这份太大了怎么办？', draft: `这份文件超过单份上限，没有传上来。怎么压缩，或者换一种方式传？${NOT_RECEIVED}` },
      }
    case 'local-rejected':
      return {
        title: '这份文件没传上来',
        subtitle: '这种文件本机收不了，这一份没有被上传。',
        pill: '没有收下',
        chip: '未收下',
        reason: '支持 PDF、JPG、PNG；Word 需本机开通转换。这一份未能上传。',
        retry: { title: '回窗口再挑一份', desc: '这一份没有收下。换一份 PDF、JPG 或 PNG 再选一次', art: 'stack' },
        alt: { title: '换一种方式', desc: '改用手机扫码上传这份文件', art: 'phone' },
        helpRow: false,
        ask: { label: '问小青：这种文件能打吗？', draft: `这份文件格式本机收不了，没有传上来。能打印的格式有哪些，Word 怎么办？${NOT_RECEIVED}` },
      }
    case 'local-unreadable':
      return {
        title: '这份文件没传上来',
        subtitle: '这份文件读不出大小，这一份没有被上传。',
        pill: '没有收下',
        chip: '未收下',
        reason: '文件为空或者大小取不到，不会硬着头皮上传一份连大小都读不出的东西。',
        retry: { title: '回窗口再挑一份', desc: '这一份没有收下。确认文件不是空的，再选一次', art: 'stack' },
        alt: { title: '换一种方式', desc: '改用手机扫码上传这份文件', art: 'phone' },
        helpRow: false,
        ask: { label: '问小青：这份读不出来', draft: `这份文件读不出大小，没有传上来。该怎么办？${NOT_RECEIVED}` },
      }
    case 'local-upload-failed':
      return {
        title: '这份文件没传上来',
        subtitle: '系统没有确认收到这一份文件。',
        pill: '没有收下',
        chip: '未收下',
        reason: '还没有收到这一份文件。可以重试刚才选择的文件。重试仍失败时，换一种方式。',
        retry: { title: '重试上传', desc: '刚才选的那份还在，直接再送一次', art: 'stack' },
        alt: { title: '换一种方式', desc: '改用手机扫码上传这份文件', art: 'phone' },
        helpRow: true,
        ask: { label: '问小青：传不上去怎么办？', draft: `文件上传没成功，系统没有确认收到。可以怎么重试，或者换一种方式？${NOT_RECEIVED}` },
      }
    case 'phone-gen-failed':
      return {
        title: '二维码没出来，文件没传上来',
        subtitle: '手机那边什么也没发生，系统没有收到任何文件。',
        pill: '没有收下',
        chip: '未收下',
        reason: '还没有收到文件，可以重新生成二维码或换一种上传方式。',
        retry: { title: '重新出一张码', desc: '再生成一张上传码，手机重新扫', art: 'phone' },
        alt: usbOk
          ? { title: '换一种方式', desc: '改用 U 盘导入这份文件', art: 'usb' }
          : { title: '换一种方式', desc: '登录后，从我的文档里选一份', art: 'stack' },
        helpRow: true,
        ask: { label: '问小青：码出不来怎么办？', draft: `上传二维码没有生成出来，文件没传上来。可以怎么重新出码，或者换一种方式？${NOT_RECEIVED}` },
      }
    case 'phone-confirm-failed':
      return {
        title: '确认没成功，当前文件还是空的',
        subtitle: '系统收到了手机传来的文件，但在这台机器上确认这一步没成功。',
        pill: '确认没成功',
        chip: '待确认',
        reason: '确认失败，当前文件仍然是空的，这份还没有进入本次办理。可以重试确认；重试仍失败，就重新出一张码。',
        retry: { title: '重试确认', desc: '再确认一次，成功后这份才成为当前文件', art: 'phone' },
        alt: { title: '重新出一张码', desc: '这份先不要了，重新出码再传一次', art: 'phone' },
        helpRow: false,
        ask: { label: '问小青：确认失败怎么办？', draft: '手机传来的文件系统已经收到，但在这台机器上确认没成功，当前文件还是空的。可以怎么重试？不要假装已经确认。' },
      }
    case 'usb-import-failed':
      return {
        title: '这一份没导进来',
        subtitle: '这一份没有导进来，U 盘上的原件没有被改。',
        pill: '没有导进来',
        chip: '没导进来',
        reason: '当前文件仍然是空的。多半是这份已经不能再导入，重新读一次 U 盘后，在新列表里再选一份。',
        retry: { title: '重新读一次 U 盘', desc: '读完在新列表里再选一份，只动你选的这一份', art: 'usb' },
        alt: { title: '改用手机扫码上传', desc: '不用 U 盘了，用手机扫码传这份文件', art: 'phone' },
        helpRow: false,
        ask: { label: '问小青：导不进来怎么办？', draft: 'U 盘里选中的文件没有导进来，当前文件还是空的。可以怎么重试，或者换一种方式？不要假装已经导入。' },
      }
    case 'usb-read-failed':
      return {
        title: '暂时无法读取 U 盘',
        subtitle: '这次没读到 U 盘里的文件，也不显示上一次的列表。',
        pill: '没有读到',
        chip: '没读到',
        reason: '本地服务连上了，但这次没能列出文件。本机不显示上一次的列表。',
        retry: { title: '重新读一次 U 盘', desc: '重新插入 U 盘，或换一个 USB 口，再读最外层文件（只读，不改动盘上内容）', art: 'usb' },
        alt: { title: '改用手机扫码上传', desc: '仍然读不出来时，用手机扫码传这份文件', art: 'phone' },
        helpRow: true,
        ask: { label: '问小青：读不了 U 盘怎么办？', draft: '这次没能读出 U 盘里的文件。可以怎么重试，或者换手机上传？不要假装读到了文件。' },
      }
  }
}
