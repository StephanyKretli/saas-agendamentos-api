import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePublicAppointmentDto {
  @ApiProperty({ example: 'clx123abc' })
  @IsString()
  @IsNotEmpty()
  serviceId: string;

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
}