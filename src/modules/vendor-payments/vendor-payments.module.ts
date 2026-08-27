import { Module } from '@nestjs/common';
import { VendorPaymentsController } from './vendor-payments.controller';
import { VendorLedgerController } from './vendor-ledger.controller';
import { VendorPaymentsService } from './vendor-payments.service';

@Module({
  controllers: [VendorPaymentsController, VendorLedgerController],
  providers: [VendorPaymentsService],
  exports: [VendorPaymentsService],
})
export class VendorPaymentsModule {}
