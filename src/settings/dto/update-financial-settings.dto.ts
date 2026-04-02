import { IsBoolean, IsNumber, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFinancialSettingsDto {
  @ApiPropertyOptional({ description: 'Define se o salão absorve a taxa do Mercado Pago' })
  @IsOptional()
  @IsBoolean()
  absorbPixFee?: boolean;

  @ApiPropertyOptional({ description: 'Porcentagem ou valor padrão da comissão (ex: 50.0)' })
  @IsOptional()
  @IsNumber()
  defaultCommissionRate?: number;

  @ApiPropertyOptional({ description: 'Tipo da comissão padrão', enum: ['PERCENTAGE', 'FIXED'] })
  @IsOptional()
  @IsString()
  @IsIn(['PERCENTAGE', 'FIXED'])
  commissionType?: string;
}