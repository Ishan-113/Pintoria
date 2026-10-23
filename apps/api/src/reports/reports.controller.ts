import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { ListOrdersDto } from '../orders/dto/orders.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Order report export (format=csv). Columns are pricing-view aware. */
  @Permissions('order.view')
  @Get('reports/orders')
  async ordersCsv(
    @CurrentUser() user: SessionUser,
    @Query() query: ListOrdersDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { csv, filename } = await this.reports.ordersCsv(user, query);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
