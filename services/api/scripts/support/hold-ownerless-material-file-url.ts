import { MaterialsService } from '../../src/materials/materials.service'
import { signFileUrl } from '../../src/files/signing'

let installed = false

/**
 * 已有材料门禁的正向用例在没有会员主人的文件上建任务时，补上本次签名地址。
 * 编号对不上或文件不存在时，后面的原有校验照旧拒绝。
 */
export function holdOwnerlessMaterialFileUrl(): void {
  if (installed) return
  installed = true
  const original = MaterialsService.prototype.createTask
  MaterialsService.prototype.createTask = function (dto, requester) {
    const sourceFileId = dto?.sourceFileId
    const next = typeof sourceFileId === 'string' && sourceFileId.length > 0 && !dto.fileAccessUrl
      ? { ...dto, fileAccessUrl: signFileUrl(sourceFileId).url }
      : dto
    return original.call(this, next, requester)
  }
}
