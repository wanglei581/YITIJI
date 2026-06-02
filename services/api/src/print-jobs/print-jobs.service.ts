import crypto from 'crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { signFileUrl } from '../files/signing'
import type { CreatePrintJobDto } from './dto/create-print-job.dto'

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
}

export interface PrintJobStatusResult {
  taskId:        string
  status:        string
  errorCode?:    string
  errorMessage?: string
  completedAt?:  string
}

// Default params matching the shared PrintJobParams shape.
const DEFAULT_PARAMS = {
  copies:        1,
  colorMode:     'black_white',
  duplex:        'simplex',
  paperSize:     'A4',
  orientation:   'auto',
  quality:       'standard',
  scale:         'fit',
  pagesPerSheet: 1,
}

// B1: 30-minute TTL for the signedUrl stored in PrintTask.fileUrl.
// Upload returns a 5-min URL; we re-sign here with a longer TTL so the
// Terminal Agent can still download the file even if claim is delayed.
const PRINT_JOB_FILE_URL_TTL_MS = 30 * 60 * 1000

/** Extract fileId from an internal signed content URL: /api/v1/files/<id>/content?... */
function extractFileIdFromSignedUrl(fileUrl: string): string | null {
  try {
    const match = fileUrl.match(/\/files\/([^/]+)\/content/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

@Injectable()
export class PrintJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePrintJobDto): Promise<PrintJobCreated> {
    const taskId = `ptask_kiosk_${crypto.randomBytes(8).toString('hex')}`

    // B1: If fileUrl is an internal signed URL, re-sign with 30-min TTL so
    // the Terminal Agent can download even after a claim delay.
    let storedFileUrl = dto.fileUrl
    const fileId = extractFileIdFromSignedUrl(dto.fileUrl)
    if (fileId) {
      const { url } = signFileUrl(fileId, PRINT_JOB_FILE_URL_TTL_MS)
      storedFileUrl = url
    }

    // fileName 持久化：PrintTask 当前无独立 fileName 列（本阶段不做 migration，方案②约定）。
    // 折中：把 fileName 落进 paramsJson，使任务详情 / 日志 / DB 中可见文件名。
    // Agent 端 parseParams 会原样带上该字段，print() 忽略未知键，无副作用。
    const storedParams: Record<string, unknown> = {
      ...(dto.params ?? DEFAULT_PARAMS),
      ...(dto.fileName ? { fileName: dto.fileName } : {}),
    }

    const task = await this.prisma.printTask.create({
      data: {
        id:         taskId,
        fileUrl:    storedFileUrl,
        // fileMd5 列名保留（方案②），实际承载 SHA-256（files 服务计算 → Kiosk 上送 → Agent SHA-256 比对）。
        fileMd5:    dto.fileMd5 ?? '',
        paramsJson: JSON.stringify(storedParams),
        status:     'pending',
      },
    })
    return {
      taskId:    task.id,
      status:    task.status,
      createdAt: task.createdAt.toISOString(),
    }
  }

  async getStatus(taskId: string): Promise<PrintJobStatusResult> {
    const task = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }
    return {
      taskId:       task.id,
      status:       task.status,
      errorCode:    task.errorCode    ?? undefined,
      errorMessage: task.errorMessage ?? undefined,
      completedAt:  task.completedAt?.toISOString(),
    }
  }
}
