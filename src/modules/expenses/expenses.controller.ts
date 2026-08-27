import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

/** SUPER_ADMIN/ADMIN only - business spend is not STAFF or MANAGER information. */
@ApiTags('Expenses (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/expenses')
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Get()
  @RequirePermissions('expenses.view')
  findAll(@Query() query: QueryExpensesDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('expenses.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('expenses.create')
  create(@Body() dto: CreateExpenseDto, @CurrentUser('id') adminId: string) {
    return this.service.create(dto, adminId);
  }

  @Patch(':id')
  @RequirePermissions('expenses.update')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
