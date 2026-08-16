/**
 * HID 扫码突发输入判据（纯逻辑，无 DOM 依赖，便于单测与门禁静态断言）。
 *
 * 背景：一体机装的是**嵌入式影像扫码模组**，不是手持扫码枪 —— 它常亮朝外、持续
 * 扫描，误扫是默认状态而不是意外。任何人举着任意码在机器前晃一下，内容就会以
 * 键盘事件的形式落进当前聚焦的控件（HID 楔式设备在操作系统眼里就是一个键盘）。
 * 用户在填手机号、搜岗位、写简历时都可能中招，且可能被表单一起提交落库。
 *
 * 判据设计的第一原则是「宁可放过，不要拦错」：拦错的后果是用户打不了字。
 * 因此下列每一条都刻意留了远超人类能力的余量：
 *
 * 1. 只看可信事件（isTrusted）。软键盘、脚本合成的事件一律不参与判定。
 *    实测本项目的 KioskKeyboard 是纯受控组件（onClick -> onChange(value + ch)），
 *    根本不派发 keydown，所以软键盘与本判据零交集。
 * 2. 排除按键自动重复（event.repeat）—— 长按一个键会产生 ~30ms 间隔的连续
 *    keydown，形态和扫码枪极像，必须排除。
 * 3. 排除输入法组合态（isComposing / keyCode 229）—— 中文输入可能产生快事件。
 * 4. 排除带 Ctrl/Meta/Alt 的组合键。
 * 5. 只统计单字符可打印键；任何功能键（Tab/Esc/方向键/Backspace…）都会重置。
 * 6. 必须连续 HID_BURST_MIN_LEN 个键、且**每两键间隔都** ≤ HID_MAX_GAP_MS 才算突发。
 *
 * 余量核算：人类最快的持续打字约 60–80ms/键（世界纪录级），触屏软键盘点按远超
 * 200ms/键；扫码模组是 5–20ms/键。取 40ms 阈值时，人类连续 8 键全部压进 40ms
 * 间隔在物理上不可能发生。
 */

/** 突发判定的最大相邻按键间隔（毫秒）。低于人类极限、高于扫码模组实测速度。 */
export const HID_MAX_GAP_MS = 40

/** 判定为扫码突发所需的最少连续快速按键数。付款码 18 位、取件码 10 位，均 > 8。 */
export const HID_BURST_MIN_LEN = 8

/** 突发确认后，多久没有后续按键就认为这一串结束（应对无回车后缀的扫码配置）。 */
export const HID_BURST_IDLE_MS = 120

export type HidKeyKind = 'printable' | 'terminator' | 'reset' | 'ignore'

/** 判定单个按键事件的类别。参数取 KeyboardEvent 的子集，便于测试构造。 */
export function classifyHidKey(event: {
  key: string
  isTrusted?: boolean
  repeat?: boolean
  isComposing?: boolean
  keyCode?: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}): HidKeyKind {
  // 合成事件（软键盘、自动化脚本、辅助技术）永远不参与突发判定。
  if (event.isTrusted === false) return 'ignore'
  if (event.repeat) return 'ignore'
  if (event.isComposing || event.keyCode === 229) return 'ignore'
  if (event.ctrlKey || event.metaKey || event.altKey) return 'ignore'
  if (event.key === 'Enter') return 'terminator'
  if (event.key.length === 1) return 'printable'
  return 'reset'
}

export type HidBurstAction =
  /** 放行：不是突发，或突发尚未确认。 */
  | 'pass'
  /** 放行，但这是一串可能突发的第一个键 —— 调用方应在此刻快照当前焦点与内容。 */
  | 'start'
  /** 吞掉：突发已确认，本键必须被 preventDefault。 */
  | 'suppress'
  /** 吞掉并收尾：已确认突发的结束键（回车），调用方应回滚快照并提示用户。 */
  | 'finish'

/**
 * 突发检测状态机。
 *
 * 注意「确认前的前缀会漏进控件」这个事实：突发要到第 HID_BURST_MIN_LEN 个键才能被
 * 确认，此前的 7 个字符已经落进了聚焦控件。所以光靠 suppress 不够，必须配合
 * 'start' 时的快照 + 'finish' 时的回滚，才能把控件恢复成扫码前的样子。
 */
export function createHidBurstDetector() {
  let length = 0
  let lastAt = 0
  let suppressing = false

  const reset = () => {
    length = 0
    lastAt = 0
    suppressing = false
  }

  return {
    /** 突发是否已确认（调用方据此决定 idle 超时后要不要收尾）。 */
    isSuppressing: () => suppressing,
    reset,
    feed(kind: HidKeyKind, at: number): HidBurstAction {
      if (kind === 'ignore') return 'pass'

      if (kind === 'printable') {
        const continues = length > 0 && at - lastAt <= HID_MAX_GAP_MS
        length = continues ? length + 1 : 1
        lastAt = at
        if (!continues) suppressing = false
        if (!suppressing && length >= HID_BURST_MIN_LEN) suppressing = true
        if (suppressing) return 'suppress'
        return length === 1 ? 'start' : 'pass'
      }

      if (kind === 'terminator') {
        // 只有「已确认突发 + 回车紧跟其后」才算扫码串的结尾。人敲的回车不受影响。
        if (suppressing && at - lastAt <= HID_MAX_GAP_MS) {
          reset()
          return 'finish'
        }
        reset()
        return 'pass'
      }

      reset()
      return 'pass'
    },
  }
}
