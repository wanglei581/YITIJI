import { Button } from '@ai-job-print/ui'
import { RotateCcwIcon, SearchIcon, SlidersHorizontalIcon, StarIcon } from 'lucide-react'
import { CATEGORY_LABEL, SELECT_CLASS, TYPE_OPTIONS } from '../utils/jobDisplay'

export function JobFilterAssistant({
  keyword,
  city,
  industry,
  category,
  favoritesOnly,
  cityOptions,
  industryOptions,
  favoriteCount,
  activeSourceName,
  debouncedKeyword,
  hasAnyFilter,
  onKeywordChange,
  onCityChange,
  onIndustryChange,
  onCategoryChange,
  onToggleFavorites,
  onReset,
}: {
  keyword: string
  city: string
  industry: string
  category: string
  favoritesOnly: boolean
  cityOptions: string[]
  industryOptions: string[]
  favoriteCount: number
  activeSourceName?: string
  debouncedKeyword: string
  hasAnyFilter: boolean
  onKeywordChange: (value: string) => void
  onCityChange: (value: string) => void
  onIndustryChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onToggleFavorites: () => void
  onReset: () => void
}) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <SlidersHorizontalIcon className="h-4 w-4 text-primary-600" />
            岗位筛选助手
          </div>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            按职位、城市、行业、类型和来源机构筛选；筛选条件会进入后端真实查询，适配客户 API / Excel / Webhook 数据。
          </p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0" onClick={onReset}>
          <RotateCcwIcon className="mr-2 h-4 w-4" />
          重置
        </Button>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          inputMode="search"
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="搜索职位名称、公司、岗位描述或技能"
          aria-label="关键词搜索"
          className="h-14 w-full rounded-lg border border-neutral-300 bg-white pl-12 pr-4 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select aria-label="选择城市" className={SELECT_CLASS} value={city} onChange={(event) => onCityChange(event.target.value)}>
          <option value="">全部城市</option>
          {cityOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          aria-label="选择行业"
          className={SELECT_CLASS}
          value={industry}
          onChange={(event) => onIndustryChange(event.target.value)}
        >
          <option value="">全部行业</option>
          {industryOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {TYPE_OPTIONS.map((option) => {
          const active = category === option.category
          return (
            <button
              key={option.label}
              onClick={() => onCategoryChange(option.category)}
              className={[
                'min-h-[64px] rounded-lg px-3 text-left transition-colors',
                active ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className={`mt-1 block text-xs ${active ? 'text-white/75' : 'text-neutral-400'}`}>{option.hint}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
        <button
          onClick={onToggleFavorites}
          aria-pressed={favoritesOnly}
          className={[
            'flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
            favoritesOnly ? 'bg-warning text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
          ].join(' ')}
        >
          <StarIcon className={`h-4 w-4 ${favoritesOnly ? 'fill-white' : ''}`} />
          只看收藏
          {favoriteCount > 0 && <span>({favoriteCount})</span>}
        </button>

        {city && <FilterChip text={city} />}
        {industry && <FilterChip text={industry} />}
        {category && <FilterChip text={CATEGORY_LABEL[category] ?? category} />}
        {activeSourceName && <FilterChip text={activeSourceName} />}
        {debouncedKeyword && <FilterChip text={`“${debouncedKeyword}”`} />}

        {hasAnyFilter && (
          <button
            onClick={onReset}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
            清空
          </button>
        )}
      </div>
    </div>
  )
}

function FilterChip({ text }: { text: string }) {
  return <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">{text}</span>
}
