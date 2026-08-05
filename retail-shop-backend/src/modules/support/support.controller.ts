import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';

@ApiTags('Support')
@Controller()
export class SupportController {
  constructor(private service: SupportService) {}

  /** Public - no login required, matches the storefront "Contact Support" form. */
  @Post('support/tickets')
  create(@Body() dto: CreateTicketDto) {
    return this.service.create(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Post('customer/support/tickets')
  createAuthenticated(@CurrentUser('id') customerId: string, @Body() dto: CreateTicketDto) {
    return this.service.create(dto, customerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Get('customer/support/tickets')
  findMine(@CurrentUser('id') customerId: string) {
    return this.service.findAllForCustomer(customerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Get('customer/support/tickets/:id')
  findOne(@CurrentUser('id') customerId: string, @Param('id') id: string) {
    return this.service.findOneForCustomer(customerId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtCustomerAuthGuard)
  @Post('customer/support/tickets/:id/messages')
  addMessage(
    @CurrentUser('id') customerId: string,
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.service.addCustomerMessage(customerId, id, dto.message);
  }
}
