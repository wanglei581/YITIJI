-- 贴牌第一步（加性迁移，不改任何已有数据）：
--   1. Organization 加三个可空的品牌覆盖字段（空 = 用平台默认）；
--   2. 新表 BrandLogo：只存贴牌 Logo（PNG / WebP），与待机宣传屏素材分开。

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "brandName" TEXT,
ADD COLUMN "brandMark" TEXT,
ADD COLUMN "brandLogoAssetId" TEXT;

-- CreateTable
CREATE TABLE "BrandLogo" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandLogo_storageKey_key" ON "BrandLogo"("storageKey");
