import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ApplyBusinessHoursTemplateDto {
  @ApiProperty({ example: 1, description: '0=Dom, 1=Seg, ... 6=Sáb' })
  @IsInt()
  @Min(0)
  @Max(6)
  sourceWeekday: number;

  @ApiProperty({ example: [2,3,4,5] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  targetWeekdays: number[];

  @ApiProperty({ example: true, required: false, description: 'Se true, apaga horários dos dias-alvo antes de copiar' })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}