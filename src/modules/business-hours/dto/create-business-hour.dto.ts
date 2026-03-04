import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min, Matches } from 'class-validator';

export class CreateBusinessHourDto {
  @ApiProperty({ example: 1, description: '0=Dom, 1=Seg, ... 6=Sáb' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: '09:00' })
  @Matches(/^\d{2}:\d{2}$/, { message: 'start deve ser HH:mm' })
  start: string;

  @ApiProperty({ example: '12:00' })
  @Matches(/^\d{2}:\d{2}$/, { message: 'end deve ser HH:mm' })
  end: string;
}