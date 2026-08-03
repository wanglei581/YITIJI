// ============================================================
// OfflineAgenciesController — Kiosk 公开端点
//
// 路由前缀：/api/v1（由 main.ts 全局设置）
//
// GET /kiosk/offline-agencies              — 机构列表（已审核已发布）
// GET /kiosk/offline-agencies/:id          — 机构详情 + 关联岗位
// GET /kiosk/offline-agencies/:id/jobs     — 机构岗位列表
// GET /kiosk/offline-jobs/:id              — 岗位详情 + 关联机构
//
// 合规：线下机构只做信息展示 + 到店指引，不代收简历、不做平台内投递
// ============================================================

import { Controller, Get, Param, Query } from '@nestjs/common'
import { OfflineAgenciesService, type AgencyListQuery, type JobListQuery } from './offline-agencies.service'

@Controller('kiosk/offline-agencies')
export class OfflineAgenciesController {
  constructor(private readonly service: OfflineAgenciesService) {}

  @Get()
  async findAll(@Query() query: AgencyListQuery) {
    return this.service.findAll(query)
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Get(':id/jobs')
  async findJobsByAgency(@Param('id') agencyId: string, @Query() query: JobListQuery) {
    return this.service.findJobsByAgency(agencyId, query)
  }
}
