import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { TargetJobContext } from './job-ai.types'

@Injectable()
export class JobContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildTargetJobContext(jobId: string): Promise<TargetJobContext> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
      select: {
        id: true,
        title: true,
        company: true,
        sourceName: true,
        sourceUrl: true,
        externalId: true,
        description: true,
        requirements: true,
        skillsJson: true,
        city: true,
        category: true,
      },
    })
    if (!job) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: '岗位不存在或未发布' } })
    }
    return {
      jobId: job.id,
      title: job.title,
      company: job.company,
      sourceName: job.sourceName,
      sourceUrl: job.sourceUrl,
      externalId: job.externalId,
      description: job.description ?? undefined,
      requirements: job.requirements ?? undefined,
      skills: parseJsonList(job.skillsJson),
      city: job.city,
      category: job.category ?? undefined,
    }
  }
}

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : []
  } catch {
    return []
  }
}
