import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';

@ApiTags('Orders (Customer)')
@ApiBearerAuth()
@UseGuards(JwtCustomerAuthGuard)
@Controller('customer/orders')
export class OrdersController {
  constructor(private service: OrdersService) {}

  @Post()
  checkout(@CurrentUser('id') customerId: string, @Body() dto: CreateOrderDto) {
    return this.service.checkout(customerId, dto);
  }

  @Get()
  findAll(@CurrentUser('id') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') customerId: string, @Param('id') id: string) {
    return this.service.findOneForCustomer(customerId, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser('id') customerId: string,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.service.cancelByCustomer(customerId, id, dto.reason);
  }
}
