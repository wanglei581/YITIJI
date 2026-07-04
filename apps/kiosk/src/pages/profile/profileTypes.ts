import type { KioskIconName } from '../../components/kiosk-icon'

export type EntryTag = '建设中' | '本次记录'

/** 墨青纸感图标 tone（对应 profile-inkpaper.css 的 .ei.* 类） */
export type EntryTone = 'teal' | 'slate' | 'plum' | 'clay' | 'wheat' | 'rose' | 'ink'

export interface Entry {
  icon: KioskIconName
  tone: EntryTone
  label: string
  /** 一句话说明（entry-grid 卡片展示；chip/account 布局忽略） */
  desc?: string
  /** 可跳转的既有功能页；缺省则按 tag 走「建设中 / 本次记录」提示 */
  route?: string
  tag?: EntryTag
}

/** 分区布局：grid=资产大卡 / chips=小行入口 / account=小方块 */
export type EntryLayout = 'grid' | 'chips' | 'account'

export interface EntrySectionData {
  title: string
  /** 区块标题旁的一句话说明 */
  subtitle?: string
  layout: EntryLayout
  /** sec-head rail 配色（缺省品牌青） */
  rail?: 'teal' | 'slate' | 'wheat' | 'plum'
  entries: Entry[]
}

export interface ResumeItem { id: string; name: string; size: string; format: string; savedAt: string }
export interface ScanItem   { id: string; name: string; size: string; pages: number; format: string; savedAt: string }
export interface AIRecord   { id: string; label: string; detail: string; fileName: string; createdAt: string }

export interface IncomingState {
  savedFile?: { name: string; size: string; pages: number; format: string }
  savedAt?: string
  savedResume?: { name: string; size: string; format: string }
  savedResumeAdvice?: {
    file?: { name: string; size: string; format: string }
    suggestions: unknown[]
    savedAt: string
  }
}

export interface ProfileHeaderStats {
  aiRecords: number | null
  favorites: number | null
  documents: number | null
}
