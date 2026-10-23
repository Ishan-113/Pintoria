import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ORDER_ACTIONS } from '@pintoria/shared';

export class CreateOrderDto {
  @IsString() @MinLength(3)
  title!: string;

  @IsString() @MinLength(2)
  itemName!: string;

  @IsString() @MinLength(5)
  specification!: string;

  @IsNumber() @Min(0.001)
  quantity!: number;

  @IsString() @MinLength(1)
  unit!: string;

  @IsDateString()
  requestedDeliveryDate!: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateRequirementDto {
  @IsString() @MinLength(2)
  itemName!: string;

  @IsString() @MinLength(5)
  specification!: string;

  @IsNumber() @Min(0.001)
  quantity!: number;

  @IsString() @MinLength(1)
  unit!: string;

  @IsDateString()
  requestedDeliveryDate!: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class RequirementDecisionDto {
  @IsIn(['approve', 'return', 'reject'])
  action!: 'approve' | 'return' | 'reject';

  @IsOptional() @IsString()
  reason?: string;
}

export class QuotationItemDto {
  @IsString() @MinLength(2)
  description!: string;

  @IsOptional() @IsString()
  specification?: string;

  @IsNumber() @Min(0.001)
  quantity!: number;

  @IsString() @MinLength(1)
  unit!: string;

  @IsNumber() @Min(0.01)
  unitRate!: number;

  @IsNumber() @Min(0) @Max(100)
  taxRatePct!: number;
}

export class PutQuotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items!: QuotationItemDto[];

  @IsOptional() @IsString()
  paymentTerms?: string;

  @IsOptional() @IsString()
  deliveryTerms?: string;

  @IsOptional() @IsDateString()
  validityDate?: string;
}

export class QuotationDecisionDto {
  @IsIn(['approve', 'request_revision', 'reject'])
  action!: 'approve' | 'request_revision' | 'reject';

  @IsOptional() @IsString()
  reason?: string;
}

export class PoItemDto {
  @IsString() @MinLength(2)
  description!: string;

  @IsNumber() @Min(0.001)
  quantity!: number;

  @IsOptional() @IsString()
  unit?: string;

  @IsNumber() @Min(0.01)
  unitRate!: number;
}

export class UploadPoDto {
  @IsString() @MinLength(2)
  poNumber!: string;

  @IsDateString()
  poDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  poItems!: PoItemDto[];

  @IsNumber() @Min(0.01)
  poTotal!: number;

  @IsOptional() @IsNumber() @Min(0)
  taxTotal?: number;

  @IsOptional() @IsString()
  paymentTerms?: string;

  @IsOptional() @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional() @IsString()
  externalRef?: string;
}

export class PoDecisionDto {
  @IsIn(['confirm', 'raise_query'])
  action!: 'confirm' | 'raise_query';

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsString()
  overrideRemark?: string;
}

export class TransitionDto {
  @IsIn([
    'start_production',
    'start_qc',
    'dispatch',
    'mark_delivered',
    'cancel_order',
  ] as (typeof ORDER_ACTIONS)[number][])
  action!: (typeof ORDER_ACTIONS)[number];

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsString()
  comment?: string;

  @IsOptional() @IsObject()
  payload?: Record<string, unknown>;
}

export class ListOrdersDto {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsUUID()
  regionId?: string;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
