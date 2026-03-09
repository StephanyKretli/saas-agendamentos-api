import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListClientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'joao',
    description: 'Search by name, phone or email',
  })
  @IsOptional()
  @IsString()
  search?: string;
}