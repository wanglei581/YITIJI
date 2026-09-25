/* ── Utility ──────────────────────────────────────────── */
export { cn } from './lib/cn'
export { getVisualThemeAttributes } from './theme/visualTheme'
export { getKioskPresentationAttributes } from './theme/visualTheme'

/* ── Base components ──────────────────────────────────── */
export { Button, buttonVariants } from './components/Button'
export { Card } from './components/Card'
export { StatusBadge, badgeVariants } from './components/StatusBadge'
export { PageHeader } from './components/PageHeader'
export { ComplianceBanner } from './components/ComplianceBanner'
export { Stepper } from './components/Stepper'
export { Drawer } from './components/Drawer'
export { Pagination } from './components/Pagination'
export { SectionCard } from './components/SectionCard'
export { Meter } from './components/Meter'
export { KioskPageFrame } from './components/KioskPageFrame'
export { KioskTopbar } from './components/KioskTopbar'
export { KioskPageHeader } from './components/KioskPageHeader'
export { KioskActionBar } from './components/KioskActionBar'
export { KioskStatePanel } from './components/KioskStatePanel'
export { KioskModal } from './components/KioskModal'

/* ── Charts (recharts) ────────────────────────────────── */
export { ResumeRadarChart } from './charts/ResumeRadarChart'
export { TrendLineChart } from './charts/TrendLineChart'
export { FunnelCard } from './charts/FunnelCard'
export { MetricGrid } from './charts/MetricGrid'

/* ── Ops data screen (Admin / Partner 数据大屏) ────────── */
export { SCREEN_REASON_COPY, SCREEN_SOURCE_ENTRY_NOTE, screenReasonCopy } from './screen/screenCopy'
export {
  ScreenBarList,
  ScreenCard,
  ScreenKpi,
  ScreenMetricCard,
  ScreenMiniGrid,
  ScreenUnavailable,
  screenCount,
} from './screen/ScreenPrimitives'
export { ScreenFleetWall, screenFleetOnlineText, screenFleetScopeNote } from './screen/ScreenFleetWall'
export { ScreenSparkline } from './screen/ScreenSparkline'
export { ScreenAlertList, ScreenGapList } from './screen/ScreenLists'
export {
  ScreenBanner,
  ScreenBody,
  ScreenDesk,
  ScreenGrid,
  ScreenHeader,
  ScreenStage,
  ScreenStatePanel,
  useScreenMotion,
  useScreenPresent,
} from './screen/ScreenFrame'
export {
  TwinBanner,
  TwinHeader,
  TwinSceneBox,
  TwinScreen,
  TwinSlot,
  TwinStatePanel,
} from './screen/twin/TwinFrame'
export { TwinMetricPanel, TwinPanel, TwinUnavailable } from './screen/twin/TwinPanel'
export {
  TwinAlertList,
  TwinAreaTrend,
  TwinBarList,
  TwinDot,
  TwinLegend,
  TwinRing,
  TwinHeat,
  TwinPulse,
  TwinSteps,
  TwinTiles,
  TwinTimeline,
  twinSmall,
} from './screen/twin/TwinCharts'
export { TwinNetwork, TwinPill, TwinPrism } from './screen/twin/TwinNetwork'
export { TwinInfoFlow, twinInfoTotal, twinInfoTotalParts } from './screen/twin/TwinInfoFlow'
export { TwinRankList } from './screen/twin/TwinRankList'
export { TWIN_STATE_TEXT, TwinCity, twinAreas, twinTerminalState, twinTerminalsFromCells } from './screen/twin/TwinCity'
export {
  TWIN_HIGHLIGHTS,
  TwinCityToolbar,
  TwinStateLegend,
  parseTwinHighlight,
  twinCountStates,
  twinSortByState,
} from './screen/twin/TwinCityControls'
export { TwinTerminalBoard } from './screen/twin/TwinTerminalBoard'
export { TWIN_DEVICE_H, TWIN_DEVICE_W, TwinDevice } from './screen/twin/TwinDevice'
export { TWIN_STAGE_H, TWIN_STAGE_W } from './screen/twin/twinMath'
export { TwinFailurePanel, TwinShell, TwinShellEmpty } from './screen/twin/TwinShell'
export { useTwinBurnInDrift, useTwinNightlyReload } from './screen/twin/useDisplayCare'

/* ── State components ─────────────────────────────────── */
export { Spinner } from './components/Spinner'
export { EmptyState } from './components/EmptyState'
export { LoadingState } from './components/LoadingState'
export { ErrorState } from './components/ErrorState'

/* ── Layout components ────────────────────────────────── */
export { KioskLayout } from './layouts/KioskLayout'
export { AdminLayout } from './layouts/AdminLayout'
export { PartnerLayout } from './layouts/PartnerLayout'

/* ── Types ────────────────────────────────────────────── */
export type { ButtonProps } from './components/Button'
export type { CardProps } from './components/Card'
export type { StatusBadgeProps } from './components/StatusBadge'
export type { PageHeaderProps } from './components/PageHeader'
export type { ComplianceBannerProps } from './components/ComplianceBanner'
export type { StepperProps, StepperStep } from './components/Stepper'
export type { DrawerProps } from './components/Drawer'
export type { PaginationProps } from './components/Pagination'
export type { SectionCardProps } from './components/SectionCard'
export type { MeterProps } from './components/Meter'
export type { KioskPageFrameProps, KioskPageStep } from './components/KioskPageFrame'
export type { KioskTopbarProps } from './components/KioskTopbar'
export type { KioskPageHeaderProps } from './components/KioskPageHeader'
export type { KioskActionBarProps } from './components/KioskActionBar'
export type { KioskStatePanelProps, KioskStateTone } from './components/KioskStatePanel'
export type { KioskModalProps } from './components/KioskModal'
export type { ResumeRadarChartProps, ResumeRadarDimension, ResumeRadarSeries } from './charts/ResumeRadarChart'
export type { TrendLineChartProps, TrendSeries } from './charts/TrendLineChart'
export type { FunnelCardProps, FunnelStep } from './charts/FunnelCard'
export type { MetricGridProps, MetricItem } from './charts/MetricGrid'
export type { ScreenReasonCopy } from './screen/screenCopy'
export type {
  ScreenBarItem,
  ScreenBarListProps,
  ScreenCardProps,
  ScreenKpiProps,
  ScreenMetricCardProps,
  ScreenMetricLike,
  ScreenMiniGridProps,
  ScreenMiniItem,
  ScreenTone,
  ScreenUnavailableProps,
} from './screen/ScreenPrimitives'
export type { ScreenFleetHealthLike, ScreenFleetValueLike, ScreenFleetWallProps } from './screen/ScreenFleetWall'
export type { ScreenSparkDay, ScreenSparklineProps } from './screen/ScreenSparkline'
export type {
  ScreenAlertListProps,
  ScreenAlertRow,
  ScreenGapEntry,
  ScreenGapListProps,
} from './screen/ScreenLists'
export type {
  ScreenBannerProps,
  ScreenBannerTone,
  ScreenBodyProps,
  ScreenGridProps,
  ScreenHeaderProps,
  ScreenHeadingLevel,
  ScreenMode,
  ScreenStageProps,
  ScreenStatePanelProps,
} from './screen/ScreenFrame'
export type {
  TwinBannerProps,
  TwinHeaderProps,
  TwinLayout,
  TwinSceneBoxProps,
  TwinScreenProps,
  TwinSlotName,
  TwinSlotProps,
  TwinStatePanelProps,
  TwinTab,
} from './screen/twin/TwinFrame'
export type { TwinMetricPanelProps, TwinPanelProps, TwinTone, TwinUnavailableProps } from './screen/twin/TwinPanel'
export type {
  TwinAlertItem,
  TwinAreaTrendProps,
  TwinBarItem,
  TwinLegendItem,
  TwinRingProps,
  TwinState,
  TwinTileItem,
  TwinTimelineSegment,
  TwinTrendDay,
  TwinHeatProps,
  TwinPulseProps,
  TwinStepItem,
} from './screen/twin/TwinCharts'
export type { TwinNetworkLane, TwinNetworkProps, TwinNetworkService } from './screen/twin/TwinNetwork'
export type { TwinInfoFlowProps, TwinInfoFlowType } from './screen/twin/TwinInfoFlow'
export type { TwinRankItem } from './screen/twin/TwinRankList'
export type { TwinChrome, TwinFailure, TwinForbiddenCopy, TwinShellMeta, TwinShellProps } from './screen/twin/TwinShell'
export type { TwinCityHighlight, TwinCityProps, TwinCityTerminal, TwinFleetCellLike } from './screen/twin/TwinCity'
export type { TwinCityToolbarProps } from './screen/twin/TwinCityControls'
export type { TwinTerminalBoardProps, TwinTerminalTwinLike } from './screen/twin/TwinTerminalBoard'
export type { TwinDeviceCallout, TwinDeviceCalloutKey, TwinDeviceProps } from './screen/twin/TwinDevice'
export type { SpinnerProps } from './components/Spinner'
export type { EmptyStateProps } from './components/EmptyState'
export type { LoadingStateProps } from './components/LoadingState'
export type { ErrorStateProps } from './components/ErrorState'
export type { VisualTheme, UiDensity } from './theme/visualTheme'
export type { KioskPresentation, KioskViewport } from './theme/visualTheme'
export type { KioskLayoutProps, KioskTab } from './layouts/KioskLayout'
export type { AdminLayoutProps, NavItem } from './layouts/AdminLayout'
export type { PartnerLayoutProps } from './layouts/PartnerLayout'
