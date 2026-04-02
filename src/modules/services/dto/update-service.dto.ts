import { IsInt, IsOptional, IsString, Min, IsArray, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ example: 'scissors' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs dos profissionais que executam este serviço' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  professionalIds?: string[];
}