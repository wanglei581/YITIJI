/* ── Utility ──────────────────────────────────────────── */
export { cn } from './lib/cn'

/* ── Base components ──────────────────────────────────── */
export { Button, buttonVariants } from './components/Button'
export { Card } from './components/Card'
export { StatusBadge, badgeVariants } from './components/StatusBadge'
export { PageHeader } from './components/PageHeader'

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
export type { SpinnerProps } from './components/Spinner'
export type { EmptyStateProps } from './components/EmptyState'
export type { LoadingStateProps } from './components/LoadingState'
export type { ErrorStateProps } from './components/ErrorState'
export type { KioskLayoutProps, KioskTab } from './layouts/KioskLayout'
export type { AdminLayoutProps, NavItem } from './layouts/AdminLayout'
export type { PartnerLayoutProps } from './layouts/PartnerLayout'
