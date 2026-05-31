/* ── Utility ──────────────────────────────────────────── */
export { cn } from './lib/cn'

/* ── Base components ──────────────────────────────────── */
export { Button, buttonVariants } from './components/Button'
export { Card } from './components/Card'
export { StatusBadge, badgeVariants } from './components/StatusBadge'
export { PageHeader } from './components/PageHeader'
export { ComplianceBanner } from './components/ComplianceBanner'
export { Stepper } from './components/Stepper'
export { Drawer } from './components/Drawer'
export { Pagination } from './components/Pagination'

/* ── Charts (recharts) ────────────────────────────────── */
export { ResumeRadarChart } from './charts/ResumeRadarChart'
export { TrendLineChart } from './charts/TrendLineChart'
export { FunnelCard } from './charts/FunnelCard'
export { MetricGrid } from './charts/MetricGrid'

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
export type { ResumeRadarChartProps, ResumeRadarDimension, ResumeRadarSeries } from './charts/ResumeRadarChart'
export type { TrendLineChartProps, TrendSeries } from './charts/TrendLineChart'
export type { FunnelCardProps, FunnelStep } from './charts/FunnelCard'
export type { MetricGridProps, MetricItem } from './charts/MetricGrid'
export type { SpinnerProps } from './components/Spinner'
export type { EmptyStateProps } from './components/EmptyState'
export type { LoadingStateProps } from './components/LoadingState'
export type { ErrorStateProps } from './components/ErrorState'
export type { KioskLayoutProps, KioskTab } from './layouts/KioskLayout'
export type { AdminLayoutProps, NavItem } from './layouts/AdminLayout'
export type { PartnerLayoutProps } from './layouts/PartnerLayout'
