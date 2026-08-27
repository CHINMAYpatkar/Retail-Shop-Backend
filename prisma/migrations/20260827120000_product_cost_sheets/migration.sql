-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "unitCostPrice" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "product_cost_sheets" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "batchYieldQuantity" INTEGER NOT NULL,
    "materialCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labourCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "packagingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalBatchCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costPerUnit" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_cost_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_sheet_items" (
    "id" TEXT NOT NULL,
    "costSheetId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "ratePerUnit" DECIMAL(12,4) NOT NULL,
    "lineCost" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "product_cost_sheet_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cost_sheets_productId_isActive_idx" ON "product_cost_sheets"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_sheets_productId_version_key" ON "product_cost_sheets"("productId", "version");

-- CreateIndex
CREATE INDEX "product_cost_sheet_items_costSheetId_idx" ON "product_cost_sheet_items"("costSheetId");

-- CreateIndex
CREATE INDEX "product_cost_sheet_items_rawMaterialId_idx" ON "product_cost_sheet_items"("rawMaterialId");

-- AddForeignKey
ALTER TABLE "product_cost_sheets" ADD CONSTRAINT "product_cost_sheets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_sheet_items" ADD CONSTRAINT "product_cost_sheet_items_costSheetId_fkey" FOREIGN KEY ("costSheetId") REFERENCES "product_cost_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_sheet_items" ADD CONSTRAINT "product_cost_sheet_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

