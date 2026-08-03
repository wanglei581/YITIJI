export type VisualTheme = 'legacy' | 'service-desk'

export type UiDensity = 'touch' | 'compact' | 'comfortable'

export function getVisualThemeAttributes(
  visualTheme: VisualTheme,
  density: UiDensity,
) {
  return {
    'data-visual-theme': visualTheme,
    'data-ux-density': density,
  } as const
}

export type KioskPresentation = 'legacy' | 'fusion-youth'

export type KioskViewport = 'kiosk' | 'mobile'

export function getKioskPresentationAttributes(
  presentation: KioskPresentation,
  viewport: KioskViewport,
) {
  return {
    'data-kiosk-presentation': presentation,
    'data-kiosk-viewport': viewport,
  } as const
}
