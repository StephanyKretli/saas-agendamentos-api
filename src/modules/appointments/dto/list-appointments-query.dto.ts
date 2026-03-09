import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    example: 'SCHEDULED',
    enum: ['SCHEDULED', 'CANCELED', 'COMPLETED'],
  })
  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELED', 'COMPLETED'])
  status?: 'SCHEDULED' | 'CANCELED' | 'COMPLETED';

  @ApiPropertyOptional({ example: 'client_id_here' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ example: 'service_id_here' })
  @IsOptional()
  @IsString()
  serviceId?: string;
}