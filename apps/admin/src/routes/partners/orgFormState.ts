import { ORG_TYPE_SCENE_TEMPLATE, SCENE_DEFAULT_MODULES, type PartnerType, type SceneTemplate } from '@ai-job-print/shared'

export function sceneFieldsForType(type: string): { sceneTemplate: SceneTemplate | null; enabledModules: string[] } {
  const scene = ORG_TYPE_SCENE_TEMPLATE[type as PartnerType] ?? null
  return {
    sceneTemplate: scene,
    enabledModules: scene ? [...SCENE_DEFAULT_MODULES[scene]] : [],
  }
}
export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

