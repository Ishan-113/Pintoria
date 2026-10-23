import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';
import { USER_ROLES } from '@pintoria/shared';
import type { UserRole } from '@pintoria/shared';

export class ListClientsDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsString()
  status?: string;
}

export class CreateClientDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsString() @MinLength(2) @MaxLength(12)
  code!: string;

  @IsOptional() @IsString()
  industry?: string;

  @IsOptional() @IsString()
  paymentTerms?: string;

  @IsOptional() @IsString()
  registeredAddress?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  state?: string;

  @IsOptional() @IsString()
  businessEmail?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  industry?: string;

  @IsOptional() @IsString()
  paymentTerms?: string;

  @IsOptional() @IsString()
  registeredAddress?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  state?: string;

  @IsOptional() @IsString()
  businessEmail?: string;
}

export class ListRegionsDto {
  @IsUUID()
  clientId!: string;
}

export class CreateRegionDto {
  @IsUUID()
  clientId!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString() @MinLength(2) @MaxLength(8)
  code!: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  managerName?: string;

  @IsOptional() @IsString()
  managerEmail?: string;
}

export class UpdateRegionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @IsOptional() @IsString()
  city?: string;

  @IsOptional() @IsString()
  managerName?: string;

  @IsOptional() @IsString()
  managerEmail?: string;
}

export class ListUsersDto {
  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsEnum(USER_ROLES)
  role?: UserRole;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  q?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  fullName!: string;

  @IsEnum(USER_ROLES)
  role!: UserRole;

  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsUUID()
  regionId?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsBoolean()
  pricingView?: boolean;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  fullName?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsUUID()
  regionId?: string;

  @IsOptional() @IsBoolean()
  pricingView?: boolean;

  @IsOptional() @IsString()
  status?: string;
}
