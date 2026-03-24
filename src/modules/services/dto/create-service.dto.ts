import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({ example: 'Corte feminino' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 60, description: 'Duration in minutes' })
  @IsInt()
  @Min(1)
  duration: number;

  @ApiProperty({ example: 8000, description: 'Price in cents' })
  @IsInt()
  @Min(0)
  priceCents: number;

  @ApiPropertyOptional({ example: 'scissors' })
  @IsOptional()
  @IsString()
  // Opcional: Se quiser restringir aos ícones da biblioteca de beleza
  @IsEnum(['scissors', 'brush', 'sparkles', 'droplets', 'flower2', 'wand2', 'crown', 'heart', 'smile'])
  icon?: string;
}