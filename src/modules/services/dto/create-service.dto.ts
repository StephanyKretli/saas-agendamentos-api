import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(5)
  duration!: number; // minutos

  @IsInt()
  @Min(0)
  priceCents!: number;
}