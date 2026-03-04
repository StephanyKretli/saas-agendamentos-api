import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateBlockedDateDto {
  // YYYY-MM-DD
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}