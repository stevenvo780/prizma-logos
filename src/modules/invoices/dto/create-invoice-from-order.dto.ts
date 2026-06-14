import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class OrderStoreDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}

class OrderCustomerDto {
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class OrderUserDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

class OrderProductDto {
  @IsInt()
  id!: number;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  code?: string;
}

class OrderItemDto {
  @ValidateNested()
  @Type(() => OrderProductDto)
  product!: OrderProductDto;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsNumber()
  @Min(0)
  finalPrice!: number;
}

export class CreateInvoiceFromOrderDto {
  @IsInt()
  id!: number;

  @ValidateNested()
  @Type(() => OrderStoreDto)
  store!: OrderStoreDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderCustomerDto)
  customer?: OrderCustomerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderUserDto)
  user?: OrderUserDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
