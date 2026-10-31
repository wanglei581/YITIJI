import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { ResumeGenEducation, ResumeGenExperience, ResumeGenProject } from '@ai-job-print/shared'

interface ResumeGenerateDraft {
  step: number
  reviewing: boolean
  basic: { name: string; phone: string; email: string; city: string }
  intention: { position: string; city: string; jobType: string; salary: string }
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skillsText: string
  certsText: string
  selfIntro: string
}

// 公共终端仅保留当前 JS 会话；不写存储、URL、history 或服务端。
// 统一清场先递增代次，已卸载/正在卸载的旧组件不得把清掉的资料重新写回来。
let draft: Partial<ResumeGenerateDraft> | null = null
let generation = 0

export function clearResumeGenerateDraft(): void {
  generation += 1
  draft = null
}

export function hasResumeGenerateDraft(): boolean {
  return draft !== null
}

export function useResumeGenerateDraftField<K extends keyof ResumeGenerateDraft>(
  key: K,
  initial: ResumeGenerateDraft[K],
): [ResumeGenerateDraft[K], Dispatch<SetStateAction<ResumeGenerateDraft[K]>>] {
  const [ownerGeneration] = useState(() => generation)
  const [value, setValue] = useState<ResumeGenerateDraft[K]>(() => draft?.[key] ?? initial)
  useEffect(() => {
    if (ownerGeneration !== generation) return
    draft = { ...draft, [key]: value }
  }, [key, value, ownerGeneration])
  return [value, setValue]
}
