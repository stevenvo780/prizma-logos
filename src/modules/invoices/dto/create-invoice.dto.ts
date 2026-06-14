import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  identification!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  branch_office?: number;
}

class CustomerDataDto {
  @IsString()
  tipoDocumento!: 'RUC' | 'DNI' | 'CE' | 'NIT' | 'CC';

  @IsString()
  numeroDocumento!: string;

  @IsString()
  razonSocial!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  activo?: boolean;
}

class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  discount?: number;
}

class InvoicePaymentDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsNumber()
  @Min(0.01)
  value!: number;

  @IsDateString()
  due_date!: string;
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerDataDto)
  customerData?: CustomerDataDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoicePaymentDto)
  payments?: InvoicePaymentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string;
}
