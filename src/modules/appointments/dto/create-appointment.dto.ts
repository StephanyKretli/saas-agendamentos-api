import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateAppointmentDto {
  @IsDateString()
  date!: string; // ISO string

  @IsOptional()
  @IsString()
  notes?: string;
}