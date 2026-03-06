import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateAppointmentClientDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class CreateAppointmentDto {
  @IsUUID()
  serviceId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAppointmentClientDto)
  client?: CreateAppointmentClientDto;
}