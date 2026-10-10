import { ORG_TYPE_SCENE_TEMPLATE, SCENE_DEFAULT_MODULES, type PartnerType, type SceneTemplate } from '@ai-job-print/shared'
import { userMessageOf } from '../../services/api/userErrorMessage'

export function sceneFieldsForType(type: string): { sceneTemplate: SceneTemplate | null; enabledModules: string[] } {
  const scene = ORG_TYPE_SCENE_TEMPLATE[type as PartnerType] ?? null
  return {
    sceneTemplate: scene,
    enabledModules: scene ? [...SCENE_DEFAULT_MODULES[scene]] : [],
  }
}
export function errMsg(e: unknown, fallback: string): string {
  return userMessageOf(e, fallback)
}

