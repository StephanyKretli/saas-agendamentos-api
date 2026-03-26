import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateMemberDto {
  @ApiProperty({ example: 'Carlos Barbeiro', description: 'Nome do profissional' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'carlos@demo.com', description: 'E-mail de acesso' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'carlos-cortes', description: 'Username para a vitrine pública' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'senha-segura123', description: 'Senha inicial de acesso' })
  @IsString()
  @MinLength(6)
  password: string;
}