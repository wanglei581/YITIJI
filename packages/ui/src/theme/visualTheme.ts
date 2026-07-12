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
