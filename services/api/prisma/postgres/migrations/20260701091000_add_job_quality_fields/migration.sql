-- 岗位标准化字段：全部 additive，可空或带默认值，不影响既有 API/Excel/Webhook 导入。

ALTER TABLE "Job" ADD COLUMN "educationRequirement" TEXT;
ALTER TABLE "Job" ADD COLUMN "experienceRequirement" TEXT;
ALTER TABLE "Job" ADD COLUMN "skillsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Job" ADD COLUMN "benefitsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Job" ADD COLUMN "salaryMin" INTEGER;
ALTER TABLE "Job" ADD COLUMN "salaryMax" INTEGER;
ALTER TABLE "Job" ADD COLUMN "salaryUnit" TEXT;
ALTER TABLE "Job" ADD COLUMN "validThrough" TIMESTAMP(3);
