/** 「少于 5」与量词之间留空格；普通数字仍紧贴量词。 */
export function measureUnit(value: string, unit: string): string {
  return value.endsWith('少于 5') ? ` ${unit}` : unit
}
