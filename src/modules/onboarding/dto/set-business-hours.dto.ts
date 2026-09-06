import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OnboardingBusinessHourDto {
  @ApiProperty({ example: 1, description: '0=Dom ... 6=Sáb' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: '09:00' })
  @IsString()
  start: string;

  @ApiProperty({ example: '18:00' })
  @IsString()
  end: string;
}

export class SetBusinessHoursDto {
  @ApiProperty({ type: [OnboardingBusinessHourDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OnboardingBusinessHourDto)
  days: OnboardingBusinessHourDto[];
}
