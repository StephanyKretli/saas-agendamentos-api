import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, IsBoolean, Max, IsNumber } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 'Stephany Kretli' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'tety' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ example: 'America/Sao_Paulo' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minBookingNoticeMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxBookingDays?: number;

 @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requirePixDeposit?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pixDepositPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mercadoPagoAccessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  centralizePayments?: boolean;
}