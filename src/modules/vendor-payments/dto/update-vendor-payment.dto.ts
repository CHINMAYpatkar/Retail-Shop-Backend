import { PartialType } from '@nestjs/swagger';
import { CreateVendorPaymentDto } from './create-vendor-payment.dto';

export class UpdateVendorPaymentDto extends PartialType(CreateVendorPaymentDto) {}
