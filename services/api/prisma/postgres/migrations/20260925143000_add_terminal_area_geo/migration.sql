-- 数据大屏终端落点：所在区与经纬度。均可空，未设置不冒充坐标。
-- 与 prisma/migrations/20260925143000_add_terminal_area_geo 对应。Float 在 PostgreSQL 为 DOUBLE PRECISION。
ALTER TABLE "Terminal" ADD COLUMN "areaLabel" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "geoLat" DOUBLE PRECISION;
ALTER TABLE "Terminal" ADD COLUMN "geoLng" DOUBLE PRECISION;
