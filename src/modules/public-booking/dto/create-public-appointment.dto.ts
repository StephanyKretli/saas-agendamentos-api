import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray, 
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CartItemDto {
  @IsString()
  serviceId: string;

  @IsOptional()
  @IsBoolean()
  isMaintenance?: boolean;
}

export class CreatePublicAppointmentDto {
  @ApiProperty({ example: 'clx123abc' })
  @IsOptional()  
  @IsString()
  serviceId?: string;

  @ApiProperty({
    example: '2026-03-10T09:00:00',
    description: 'Appointment date in ISO format',
  })
  @IsISO8601()
  date: string;

  @IsString()
  @IsNotEmpty()
  professionalId: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  clientName: string;

  @ApiProperty({ example: '31999999999' })
  @IsString()
  @IsNotEmpty()
  clientPhone: string;

  @ApiPropertyOptional({ example: 'joao@email.com' })
  @IsOptional()
  @IsEmail()
  clientEmail?: string;

  @ApiPropertyOptional({ example: 'Primeira visita' })
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  services?: CartItemDto[];
}