import { IsISO8601, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateAppointmentDto {
  @IsUUID()
  serviceId: string;

  @IsISO8601()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;
}