import { Module } from '@nestjs/common';
import { PurchaseBillsController } from './purchase-bills.controller';
import { PurchaseBillsService } from './purchase-bills.service';

@Module({
  controllers: [PurchaseBillsController],
  providers: [PurchaseBillsService],
  exports: [PurchaseBillsService],
})
export class PurchaseBillsModule {}
