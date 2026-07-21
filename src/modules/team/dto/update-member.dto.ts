import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

/**
 * Antes esta rota usava `@Body() body: any`, o que deixava o ValidationPipe
 * global sem nada para validar — o `role` podia ser setado para qualquer
 * string arbitraria (inclusive fora de PROFESSIONAL/ADMIN).
 */
export class UpdateMemberDto {
  @ApiPropertyOptional({ example: 'Carlos Barbeiro' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'carlos@demo.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ enum: ['PROFESSIONAL', 'ADMIN'] })
  @IsOptional()
  @IsString()
  @IsIn(['PROFESSIONAL', 'ADMIN'])
  role?: string;
}
