import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  ListOrdersDto,
  PoDecisionDto,
  PutQuotationDto,
  QuotationDecisionDto,
  RequirementDecisionDto,
  TransitionDto,
  UpdateRequirementDto,
  UploadPoDto,
} from './dto/orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Permissions('order.create')
  @Post('orders')
  create(@CurrentUser() user: SessionUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Permissions('order.view')
  @Get('orders')
  list(@CurrentUser() user: SessionUser, @Query() query: ListOrdersDto) {
    return this.orders.list(user, query);
  }

  @Permissions('order.view')
  @Get('orders/:id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.getById(user, id);
  }

  @Permissions('requirement.update')
  @Post('orders/:id/requirement-versions')
  updateRequirement(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.orders.updateRequirement(user, id, dto);
  }

  @Permissions('requirement.decide')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/requirement-decision')
  requirementDecision(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: RequirementDecisionDto,
  ) {
    return this.orders.requirementDecision(user, id, dto);
  }

  @Permissions('quotation.manage')
  @Post('orders/:id/quotations')
  createQuotationDraft(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.createQuotationDraft(user, id);
  }

  @Permissions('quotation.decide')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/quotation-decision')
  quotationDecision(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: QuotationDecisionDto,
  ) {
    return this.orders.quotationDecision(user, id, dto);
  }

  @Permissions('quotation.manage')
  @Put('quotations/:id')
  updateQuotationDraft(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: PutQuotationDto,
  ) {
    return this.orders.updateQuotationDraft(user, id, dto);
  }

  @Permissions('quotation.manage')
  @Post('quotations/:id/submit')
  submitQuotation(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.submitQuotation(user, id);
  }

  @Permissions('po.upload')
  @Post('orders/:id/purchase-orders')
  uploadPo(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: UploadPoDto,
  ) {
    return this.orders.uploadPo(user, id, dto);
  }

  @Permissions('order.view')
  @Get('orders/:id/purchase-orders/:poId/checklist')
  poChecklist(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('poId') poId: string,
  ) {
    return this.orders.getPoChecklist(user, id, poId);
  }

  @Permissions('po.verify')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/purchase-orders/:poId/decision')
  poDecision(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Param('poId') poId: string,
    @Body() dto: PoDecisionDto,
  ) {
    return this.orders.poDecision(user, id, poId, dto);
  }

  @Permissions('order.view')
  @HttpCode(HttpStatus.OK)
  @Post('orders/:id/transitions')
  transition(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body() dto: TransitionDto,
  ) {
    return this.orders.transition(user, id, dto);
  }

  @Permissions('audit.view')
  @Get('orders/:id/audit')
  auditTrail(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.orderAudit(user, id);
  }
}
