import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateBlockedSlotDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}