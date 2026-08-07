import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@ApiTags('Addresses')
@ApiBearerAuth()
@UseGuards(JwtCustomerAuthGuard)
@Controller('customer/addresses')
export class AddressesController {
  constructor(private service: AddressesService) {}

  @Get()
  findAll(@CurrentUser('id') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  @Post()
  create(@CurrentUser('id') customerId: string, @Body() dto: CreateAddressDto) {
    return this.service.create(customerId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('id') customerId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.service.update(id, customerId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') customerId: string) {
    return this.service.remove(id, customerId);
  }
}
