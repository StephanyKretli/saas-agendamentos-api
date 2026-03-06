import { IsOptional, IsString, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClientDto {

  @ApiProperty({
    example: 'João Silva',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: '31999999999',
    required: false,
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    example: 'joao@email.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'Cliente prefere horário da manhã',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}