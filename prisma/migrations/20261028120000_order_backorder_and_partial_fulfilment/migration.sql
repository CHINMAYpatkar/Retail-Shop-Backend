-- Backorder and partial fulfilment.
--
-- Entirely additive: every new column has a default and no existing row changes
-- meaning. An order placed before this migration reads back as holdForStock
-- false with every line PENDING, which is exactly what it was.
--
-- The ADD VALUE statements are safe inside Prisma's transaction on PostgreSQL
-- 12+ (this database is 18) because nothing in this migration USES the new
-- values - it only declares them. Writing a row with AWAITING_STOCK in the same
-- transaction would fail.

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'AWAITING_STOCK', 'SHIPPED', 'DELIVERED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_STOCK';
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_SHIPPED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "availabilityNote" TEXT,
ADD COLUMN     "expectedAvailabilityDate" TIMESTAMP(3),
ADD COLUMN     "fulfilmentStatus" "OrderItemStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "holdForStock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "order_payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_payments_orderId_idx" ON "order_payments"("orderId");

-- AddForeignKey
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

