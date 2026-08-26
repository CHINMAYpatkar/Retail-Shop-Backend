-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('GRAM', 'KILOGRAM', 'MILLILITRE', 'LITRE', 'PIECE', 'PACKET');

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_materials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "baseUnit" "MeasurementUnit" NOT NULL,
    "stockQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(12,3),
    "avgCostPerUnit" DECIMAL(12,4),
    "lastPurchasePrice" DECIMAL(12,4),
    "ingredientId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_isActive_idx" ON "vendors"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_code_key" ON "raw_materials"("code");

-- CreateIndex
CREATE INDEX "raw_materials_isActive_idx" ON "raw_materials"("isActive");

-- CreateIndex
CREATE INDEX "raw_materials_ingredientId_idx" ON "raw_materials"("ingredientId");

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

