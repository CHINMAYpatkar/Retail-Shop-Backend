-- CreateEnum
CREATE TYPE "StorageDriverName" AS ENUM ('LOCAL', 'S3');

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "driver" "StorageDriverName",
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "storageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_type_folder_idx" ON "media_assets"("type", "folder");

-- CreateIndex
CREATE INDEX "media_assets_createdAt_idx" ON "media_assets"("createdAt");

