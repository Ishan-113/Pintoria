import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Kinds of artifacts we attach to workflow entities. */
export const FILE_KINDS = ['requirement_spec', 'quotation_document', 'po_document', 'reference', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_ENTITY_TYPES = ['REQUIREMENT_VERSION', 'QUOTATION', 'PURCHASE_ORDER', 'ORDER'] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

export class UploadFileMetadataDto {
  @ApiProperty({ enum: FILE_ENTITY_TYPES })
  @IsIn(FILE_ENTITY_TYPES as unknown as string[])
  entityType!: FileEntityType;

  /** UUID of the entity the file attaches to (required unless entityType=ORDER, where it is the orderId). */
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ enum: FILE_KINDS })
  @IsIn(FILE_KINDS as unknown as string[])
  kind!: FileKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
