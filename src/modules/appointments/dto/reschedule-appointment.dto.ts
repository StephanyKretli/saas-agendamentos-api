import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-03-10T10:30:00.000Z' })
  @IsString()
  date!: string;
}