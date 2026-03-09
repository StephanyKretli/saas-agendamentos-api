import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class RescheduleAppointmentDto {
  @ApiProperty({
    example: '2026-03-10T14:00:00',
    description: 'New appointment date in ISO format',
  })
  @IsISO8601()
  date: string;
}