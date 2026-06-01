import crypto from 'crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
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

@Injectable()
export class PrintJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePrintJobDto): Promise<PrintJobCreated> {
    const taskId = `ptask_kiosk_${crypto.randomBytes(8).toString('hex')}`
    const task = await this.prisma.printTask.create({
      data: {
        id:         taskId,
        fileUrl:    dto.fileUrl,
        fileMd5:    dto.fileMd5 ?? '',
        paramsJson: JSON.stringify(dto.params ?? DEFAULT_PARAMS),
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
