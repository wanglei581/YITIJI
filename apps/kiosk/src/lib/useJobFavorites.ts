// ============================================================
// useJobFavorites — 岗位收藏（纯本地 localStorage）
//
// 合规：收藏仅记录岗位 id 到本机 localStorage，用于「我感兴趣的岗位」浏览，
// 绝不上传简历、不形成投递/招聘闭环，不与任何企业端数据关联。
//
// 用 useSyncExternalStore 做一个极简模块级 store，
// 让列表页与详情页的收藏状态实时一致。
// ============================================================

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'kiosk:jobFavorites:v1'

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let cache: string[] = read()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function persist(next: string[]) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage 不可用（隐私模式 / 配额）时静默降级，仅内存生效
  }
  emit()
}

export function toggleFavorite(id: string) {
  persist(cache.includes(id) ? cache.filter((x) => x !== id) : [...cache, id])
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): string[] {
  return cache
}

/** 返回收藏的岗位 id 列表（响应式） */
export function useJobFavorites(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
