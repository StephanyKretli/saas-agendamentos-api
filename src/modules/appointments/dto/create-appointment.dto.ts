import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  serviceId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}