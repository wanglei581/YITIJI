import { useEffect, useState, type ReactNode, type Ref } from 'react'
import { POLICY_KEYWORD_MAX_LENGTH, committedKeyword, policyKeywordCount } from './policySearchModel'
import { subscribePolicyKeywordClear } from './policyKeywordSession'

const PLACEHOLDER = '输入一个词找政策，比如「补贴」「见习」'

function Magnifier({ size = 28 }: { size?: number }) {
  return <svg className="policy-search-mag" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M15.5 15.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
}

function KeyboardMark() {
  return <span className="policy-search-kbi" aria-hidden="true">
    <svg width="30" height="30" viewBox="0 0 24 24">
      <rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </span>
}

export type PolicySearchFieldViewProps = {
  value: string
  composition?: string
  /** 正在点着框或还在组字。框变青绿，并写出字数。 */
  active: boolean
  /** 框里已经有字。清空和搜索留着，字数先收起。 */
  filled: boolean
  disabled?: boolean
  showGo?: boolean
  clearLabel?: string
  inputRef?: Ref<HTMLInputElement>
  onValue: (value: string) => void
  onCompositionStart?: () => void
  onCompositionUpdate?: (data: string) => void
  onCompositionEnd?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onSearch: () => void
  onClear: () => void
}

/** 纯展示。字数由 policyKeywordCount 算，组字中的拼音不计入。 */
export function PolicySearchFieldView({
  value, composition = '', active, filled, disabled = false, showGo = true, clearLabel = '清空', inputRef,
  onValue, onCompositionStart, onCompositionUpdate, onCompositionEnd, onFocus, onBlur, onSearch, onClear,
}: PolicySearchFieldViewProps) {
  const count = policyKeywordCount(value, composition)
  const over = count > POLICY_KEYWORD_MAX_LENGTH
  const idle = !active && !filled
  const canSearch = !disabled && count > 0 && !over
  const showHint = active || over
  const showClear = !idle && value.length > 0
  // 结果页静态态用 showGo 关掉「搜索」。一点进输入态（active）就要把「搜索」和 × 一起放出来。
  const showSearch = !idle && (showGo || active)
  let hint: ReactNode = null
  if (showHint && over) {
    hint = <div className="policy-search-hint is-bad">
      <span>最多 {POLICY_KEYWORD_MAX_LENGTH} 个字，现在 {count} 个字</span>
      <b data-testid="policy-search-count">{count} / {POLICY_KEYWORD_MAX_LENGTH}</b>
    </div>
  } else if (showHint) {
    hint = <div className="policy-search-hint">
      <span>按政策标题和摘要找，输入一个词就行</span>
      <b data-testid="policy-search-count">{count} / {POLICY_KEYWORD_MAX_LENGTH}</b>
    </div>
  }
  return <div className="policy-search" data-testid="policy-search">
    <div className="policy-search-row">
      <div className="policy-search-wrap">
        <label className={`policy-search-field${active && !over ? ' is-on' : ''}${over ? ' is-bad' : ''}${showClear ? ' has-clear' : ''}`}>
          <Magnifier />
          <input
            ref={inputRef}
            data-testid="policy-search-input"
            type="text"
            enterKeyHint="search"
            inputMode="search"
            placeholder={PLACEHOLDER}
            aria-label="输入一个词找政策"
            value={value}
            disabled={disabled}
            onChange={(event) => onValue(event.target.value)}
            onCompositionStart={() => onCompositionStart?.()}
            onCompositionUpdate={(event) => onCompositionUpdate?.(event.data ?? '')}
            onCompositionEnd={() => onCompositionEnd?.()}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (canSearch) onSearch()
            }}
          />
          {idle && <KeyboardMark />}
        </label>
        {showClear && <button type="button" className="policy-search-clear" data-testid="policy-search-clear"
          aria-label={clearLabel} disabled={disabled} onClick={onClear}>
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>}
      </div>
      {showSearch && <button type="button" className="policy-search-go" data-testid="policy-search-go"
        disabled={!canSearch}
        // 按下时别抢走输入框焦点，否则结果页会先退出输入态，按钮被卸掉，点不中。
        onPointerDown={(event) => event.preventDefault()}
        onClick={onSearch}>
        <Magnifier size={30} />搜索
      </button>}
    </div>
    {hint}
    {over && <p className="policy-search-tip">这里按政策标题和摘要里的词找，输入一个词就够，比如「创业」「补贴」。</p>}
  </div>
}

export function PolicySearchField({
  disabled = false, showGo = true, clearLabel, initial = '', inputRef, onSearch, onClear,
}: {
  disabled?: boolean
  showGo?: boolean
  clearLabel?: string
  initial?: string
  inputRef?: Ref<HTMLInputElement>
  onSearch: (word: string) => void
  onClear?: () => void
}) {
  const [value, setValue] = useState(initial)
  const [composition, setComposition] = useState('')
  const [focused, setFocused] = useState(false)
  useEffect(() => subscribePolicyKeywordClear(() => {
    setValue('')
    setComposition('')
    setFocused(false)
  }), [])
  const submit = () => {
    const count = policyKeywordCount(value, composition)
    const word = committedKeyword(value, composition).trim()
    if (disabled || count === 0 || count > POLICY_KEYWORD_MAX_LENGTH) return
    onSearch(word)
  }
  return <PolicySearchFieldView
    value={value}
    composition={composition}
    active={focused || composition.length > 0}
    filled={value.length > 0}
    disabled={disabled}
    showGo={showGo}
    clearLabel={clearLabel}
    inputRef={inputRef}
    onValue={setValue}
    onCompositionStart={() => setComposition('')}
    onCompositionUpdate={setComposition}
    onCompositionEnd={() => setComposition('')}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onSearch={submit}
    onClear={() => {
      setValue('')
      setComposition('')
      onClear?.()
    }}
  />
}
