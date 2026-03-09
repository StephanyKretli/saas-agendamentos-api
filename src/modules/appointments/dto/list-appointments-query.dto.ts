import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELED', 'COMPLETED'])
  status?: 'SCHEDULED' | 'CANCELED' | 'COMPLETED';

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;
}