import { ORG_TYPE_SCENE_TEMPLATE, SCENE_DEFAULT_MODULES, type PartnerType, type SceneTemplate } from '@ai-job-print/shared'

export function sceneFieldsForType(type: string): { sceneTemplate: SceneTemplate | null; enabledModules: string[] } {
  const scene = ORG_TYPE_SCENE_TEMPLATE[type as PartnerType] ?? null
  return {
    sceneTemplate: scene,
    enabledModules: scene ? [...SCENE_DEFAULT_MODULES[scene]] : [],
  }
}

/**
 * 打开存量机构详情时补齐缺失或不匹配的只读场景模板，避免用户只改联系人/名称就被
 * 后端 ORG_TYPE_MATRIX_VIOLATION 拦截（PlanA-1）。已有模块配置原样保留，仅在为空时补默认值。
 */
export function normalizeOrgEditScene(input: {
  type: string
  sceneTemplate: SceneTemplate | null | undefined
  enabledModules: string[] | undefined
}): { sceneTemplate: SceneTemplate | null; enabledModules: string[]; backfilled: boolean } {
  const currentModules = Array.isArray(input.enabledModules) ? input.enabledModules : []
  if (!(input.type in ORG_TYPE_SCENE_TEMPLATE)) {
    return {
      sceneTemplate: input.sceneTemplate ?? null,
      enabledModules: currentModules,
      backfilled: false,
    }
  }
  const canonical = sceneFieldsForType(input.type)
  const currentScene = input.sceneTemplate ?? null
  if (currentScene === canonical.sceneTemplate) {
    return {
      sceneTemplate: currentScene,
      enabledModules: currentModules,
      backfilled: false,
    }
  }
  return {
    sceneTemplate: canonical.sceneTemplate,
    enabledModules: currentModules.length > 0 ? currentModules : canonical.enabledModules,
    backfilled: true,
  }
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

