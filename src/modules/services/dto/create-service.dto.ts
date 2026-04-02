import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min, IsOptional, IsIn, IsArray } from 'class-validator';

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
  icon?: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs dos profissionais que executam este serviço' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  professionalIds?: string[];
}