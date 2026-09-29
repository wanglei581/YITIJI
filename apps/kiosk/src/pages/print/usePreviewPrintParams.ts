// 预览页的打印参数状态（商用收口 P0-5，F20）。
//
// 初值依次取：交接上下文里用户上次定的参数 → 来源给的建议 → 全局最保守基线。
// 以前彩色、双面初值固定取基线，从确认页「返回预览与参数」回来就被打回黑白单面。
// 按本机能力降级只在能力加载完之后做：加载中一律按不可用算，那时降级会把已开通机器上的选择也砍掉。

import { useEffect, useState } from 'react'
import {
  VERIFIED_PRINT_PARAMETER_PROFILE,
  type ColorMode,
  type DuplexMode,
  type PrintJobParams,
  type PrintOrientation,
  type PrintScale,
} from '@ai-job-print/shared'
import type { PrintParamCapabilityState } from '../../hooks/usePrintParamCapability'
import type { PrintHandoffContext } from './printHandoff'

function initialParams(handoff: PrintHandoffContext | null): Partial<PrintJobParams> {
  if (handoff?.printParams) return handoff.printParams
  return { ...VERIFIED_PRINT_PARAMETER_PROFILE, ...(handoff?.paramsSuggestion ?? {}) }
}

export function usePreviewPrintParams(handoff: PrintHandoffContext | null, capability: PrintParamCapabilityState) {
  const [initial] = useState(() => initialParams(handoff))
  const [copies, setCopies] = useState(initial.copies ?? 1)
  const [colorMode, setColorMode] = useState<ColorMode>(initial.colorMode ?? VERIFIED_PRINT_PARAMETER_PROFILE.colorMode)
  const [duplex, setDuplex] = useState<DuplexMode>(initial.duplex ?? VERIFIED_PRINT_PARAMETER_PROFILE.duplex)
  const [orientation, setOrientation] = useState<PrintOrientation>(initial.orientation ?? 'auto')
  const [scale, setScale] = useState<PrintScale>(initial.scale ?? 'fit')
  const customInitial = initial.pageRange && initial.pageRange !== 'all' ? initial.pageRange : ''
  const [pageRange, setPageRange] = useState<'all' | 'custom'>(customInitial ? 'custom' : 'all')
  const [customRange, setCustomRange] = useState(customInitial)
  /** 能力加载完后真的改过参数时，逐项说明改了什么（不静默降级）。 */
  const [capabilityNote, setCapabilityNote] = useState<string | null>(null)

  useEffect(() => {
    if (capability.loading) return
    const notes: string[] = []
    if (!capability.color.allowed && colorMode !== 'black_white') {
      setColorMode('black_white')
      notes.push('彩色本机暂未开通，已改为黑白')
    }
    if (!capability.duplex.allowed && duplex !== 'simplex') {
      setDuplex('simplex')
      notes.push('双面本机暂未开通，已改为单面')
    }
    if (notes.length > 0) setCapabilityNote(notes.join('；'))
  }, [capability.loading, capability.color.allowed, capability.duplex.allowed, colorMode, duplex])

  return {
    copies, setCopies,
    colorMode, setColorMode,
    duplex, setDuplex,
    orientation, setOrientation,
    scale, setScale,
    pageRange, setPageRange,
    customRange, setCustomRange,
    capabilityNote,
  }
}
