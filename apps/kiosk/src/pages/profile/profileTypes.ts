import type { LucideIcon } from 'lucide-react'

export type EntryTag = '建设中' | '本次记录'

export interface Entry {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  /** 可跳转的既有功能页；缺省则按 tag 走「建设中 / 本次记录」提示 */
  route?: string
  tag?: EntryTag
}

export interface EntrySectionData {
  title: string
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
