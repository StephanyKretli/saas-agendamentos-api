import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class CreateFeedbackDto {
  @IsNotEmpty()
  @IsIn(['SUGGESTION', 'COMPLIMENT', 'BUG'])
  type: 'SUGGESTION' | 'COMPLIMENT' | 'BUG';

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  message: string;
}