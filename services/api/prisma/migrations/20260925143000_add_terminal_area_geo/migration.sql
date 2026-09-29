-- 数据大屏终端落点：所在区与经纬度。均可空，未设置不冒充坐标。
ALTER TABLE "Terminal" ADD COLUMN "areaLabel" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "geoLat" REAL;
ALTER TABLE "Terminal" ADD COLUMN "geoLng" REAL;
