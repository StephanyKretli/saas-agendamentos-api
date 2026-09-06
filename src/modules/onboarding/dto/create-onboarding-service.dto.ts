import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateOnboardingServiceDto {
  @ApiProperty({ example: 'Manicure' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 8000, description: 'Preço em centavos (BRL)' })
  @IsInt()
  @Min(0)
  priceCents: number;

  @ApiProperty({ example: 60, description: 'Duração em minutos' })
  @IsInt()
  @Min(1)
  durationMinutes: number;
}
