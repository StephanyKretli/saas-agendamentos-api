import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { IsEnum } from 'class-validator';
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
  // Opcional: Se quiser restringir aos ícones da biblioteca de beleza
  @IsEnum(['scissors', 'brush', 'sparkles', 'droplets', 'flower2', 'wand2', 'crown', 'heart', 'smile'])
  icon?: string;
}