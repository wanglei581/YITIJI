/**
 * 教育、工作、项目行在生成稿里的下标。
 * 不可枚举，JSON.stringify 不会带上，所以不进草稿、不进导出、不改接口。
 * 旧对象没有这个记号时，比对退回名称、相似度和同名序号。
 */
const generatedEntryIndex = Symbol('generatedEntryIndex')

export function readGeneratedEntryIndex(source: object): number | null {
  if (!(generatedEntryIndex in source)) return null
  const value = (source as { [generatedEntryIndex]?: unknown })[generatedEntryIndex]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

export function defineGeneratedEntryIndex(target: object, index: number): void {
  Object.defineProperty(target, generatedEntryIndex, {
    value: index,
    enumerable: false,
    configurable: true,
    writable: false,
  })
}

export function stampGeneratedEntryIndexes<T extends {
  education: object[]
  experience: object[]
  projects: object[]
}>(resume: T): T {
  const stampList = <R extends object>(rows: R[]): R[] => rows.map((row, index) => {
    const next = { ...row }
    defineGeneratedEntryIndex(next, index)
    return next
  })
  return {
    ...resume,
    education: stampList(resume.education),
    experience: stampList(resume.experience),
    projects: stampList(resume.projects),
  } as T
}

/** 编辑区改一行时保留下标。对象展开不会拷贝不可枚举属性。 */
export function copyEntryFields<T extends object>(row: T, patch: Partial<T>): T {
  const next = { ...row, ...patch }
  const index = readGeneratedEntryIndex(row)
  if (index !== null) defineGeneratedEntryIndex(next, index)
  return next as T
}

/** 预览页载入生成稿时盖下标。没有稿就返回 null。页面和用例都走这里。 */
export function loadStampedGeneratedResume<T extends {
  education: object[]
  experience: object[]
  projects: object[]
}>(resume: T | null | undefined): T | null {
  if (!resume) return null
  return stampGeneratedEntryIndexes(resume)
}

/** 编辑区改一行。页面编辑器和用例都走这里，避免展开对象时丢掉下标。 */
export function editStampedEntry<T extends object>(row: T, patch: Partial<T>): T {
  return copyEntryFields(row, patch)
}
