import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, Matches, IsInt, Min, Max } from 'class-validator';

export class CreateBusinessHoursBulkDto {
  @ApiProperty({ example: [1,2,3,4,5] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays: number[];

  @ApiProperty({ example: "09:00" })
  @Matches(/^\d{2}:\d{2}$/)
  start: string;

  @ApiProperty({ example: "18:00" })
  @Matches(/^\d{2}:\d{2}$/)
  end: string;
}