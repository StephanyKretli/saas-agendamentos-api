import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class CreateMemberDto {
  @ApiProperty({ example: 'Carlos Barbeiro', description: 'Nome do profissional' })
  @IsString()
  @IsNotEmpty()
  name!: string; // 🌟 Adicionamos o ! aqui

  @ApiProperty({ example: 'carlos@demo.com', description: 'E-mail de acesso' })
  @IsEmail()
  email!: string; // 🌟 Adicionamos o ! aqui

  @ApiPropertyOptional({ description: 'Gerado automaticamente se não enviado' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Gerado automaticamente se não enviado' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string; // Como tem o ?, o TypeScript não reclama

  @IsOptional()
  @IsString()
  @IsIn(['PROFESSIONAL', 'ADMIN'])
  role?: string; // Como tem o ?, o TypeScript não reclama
}