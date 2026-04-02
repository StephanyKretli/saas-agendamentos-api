import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class CreateMemberDto {
  @ApiProperty({ example: 'Carlos Barbeiro', description: 'Nome do profissional' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'carlos@demo.com', description: 'E-mail de acesso' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Gerado automaticamente se não enviado' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Gerado automaticamente se não enviado' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PROFESSIONAL', 'ADMIN'])
  role?: string;
}