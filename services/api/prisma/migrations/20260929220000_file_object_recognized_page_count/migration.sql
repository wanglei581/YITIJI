-- FileObject.pageCount：从文件字节识别出的页数。
-- 可空且不设默认值。null 表示尚未识别，不得用 0 表示未知。
-- 存量行保持 null，列表不会把它们说成 0 页。
ALTER TABLE "FileObject" ADD COLUMN "pageCount" INTEGER;
