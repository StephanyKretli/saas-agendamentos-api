import { Type } from 'class-transformer';
import { 
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsBoolean
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAppointmentClientDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({ example: '31999999999' })
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ApiPropertyOptional({ example: 'joao@email.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateAppointmentDto {
  @ApiProperty({ example: 'clx123abc' })
  @IsString()
  @IsNotEmpty()
  serviceId?: string;

  @ApiProperty({
    example: '2026-03-10T09:00:00',
    description: 'Appointment date in ISO format',
  })
  @IsNotEmpty()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ example: 'client_123' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ type: CreateAppointmentClientDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAppointmentClientDto)
  client?: CreateAppointmentClientDto;

  @ApiPropertyOptional({ example: 'Observações...' })
  @IsOptional()
  @IsString()
  notes?: string;

  // 🌟 O CONVITE VIP: Isto é o que impede o erro "should not exist"
  @ApiPropertyOptional({ example: 'prof_123' })
  @IsOptional()
  @IsString()
  professionalId?: string;

  @IsOptional()
  @IsBoolean()
  isMaintenance?: boolean;
}