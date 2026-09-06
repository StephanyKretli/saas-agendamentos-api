import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetUsernameDto {
  @ApiProperty({ example: 'studio-beauty' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  username: string;
}
