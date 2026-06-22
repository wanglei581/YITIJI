-- Branch 2: 保存期限策略支持 long_term。
-- 仅改变 FileObject.expiresAt 空值能力,不修改 AiResumeResult.expiresAt 的历史 null 语义。

ALTER TABLE "FileObject" ALTER COLUMN "expiresAt" DROP NOT NULL;
