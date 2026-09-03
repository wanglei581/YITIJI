import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { JobApplicationsService } from './job-applications.service'
import { CreateJobApplicationDto } from './dto/create-job-application.dto'
import { UpdateJobApplicationDto } from './dto/update-job-application.dto'
import {
  JOB_APPLICATION_STATUSES,
  type JobApplicationItem,
  type JobApplicationStatus,
} from './job-application.types'

/**
 * 我的求职进度接口。路由前缀 /api/v1/me/job-applications。
 *
 * **注意路由前缀是 `me/`** —— 这不是偶然。本资源只存在于「我的」命名空间下，
 * 全部受 EndUserAuthGuard 保护，endUserId 只能来自校验后的会员 token。
 * 合规上这意味着：**没有 admin 路由、没有 partner 路由、没有任何对外读取入口**
 * （compliance-boundary.md §4.4A 禁止项第 2、3 条）。加任何这类入口都会让
 * verify:job-application-track 变红。
 *
 * 同样没有的：任何接收第三方状态回流的端点（webhook / callback / sync）。
 * 没有回流入口，就没有招聘闭环 —— 这是本能力不需要人力资源服务许可证的根据。
 */
@Controller('me/job-applications')
@UseGuards(EndUserAuthGuard)
export class JobApplicationsController {
  constructor(private readonly applications: JobApplicationsService) {}

  /** 我的求职进度列表（本人，可选 ?status= 过滤；游标分页）。 */
  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<{ items: JobApplicationItem[]; nextCursor: string | null; total: number }>> {
    return ApiResponse.ok(
      await this.applications.list(user.endUserId, parseMemberPageQuery(cursor, pageSize), this.parseStatus(status)),
    )
  }

  /** 记录一次投递（新建一条本人求职进度）。 */
  @Post()
  async create(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: CreateJobApplicationDto,
  ): Promise<ApiResponse<JobApplicationItem>> {
    return ApiResponse.ok(await this.applications.create(user.endUserId, dto))
  }

  /** 更新本人的一条记录。 */
  @Patch(':id')
  async update(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobApplicationDto,
  ): Promise<ApiResponse<JobApplicationItem>> {
    return ApiResponse.ok(await this.applications.update(user.endUserId, id, dto))
  }

  /** 删除本人的一条记录（幂等）。 */
  @Delete(':id')
  async remove(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return ApiResponse.ok(await this.applications.remove(user.endUserId, id))
  }

  private parseStatus(status?: string): JobApplicationStatus | undefined {
    if (status === undefined || status === '') return undefined
    if (!(JOB_APPLICATION_STATUSES as string[]).includes(status)) {
      throw new BadRequestException({
        error: {
          code: 'JOB_APPLICATION_INVALID_STATUS',
          message: 'status 必须是 intention / applied / interviewing / offered / rejected 之一',
        },
      })
    }
    return status as JobApplicationStatus
  }
}
