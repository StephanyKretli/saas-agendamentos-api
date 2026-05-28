import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Stephany Kretli' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'stephany@email.com' })
  @IsEmail()
  email: string;

  // 🌟 O NOVO GUARDIÃO DO WHATSAPP
  @ApiProperty({ example: '11999999999' })
  @IsString()
  @IsNotEmpty({ message: 'O número de WhatsApp é obrigatório.' })
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({
    example: 'stephany',
    description: 'Public username used in booking URL',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @IsOptional()
  @IsString()
  plan?: string;
}
