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