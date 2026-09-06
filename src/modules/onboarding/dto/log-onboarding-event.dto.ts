import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export const ONBOARDING_ACTIONS = ['entrou', 'concluiu', 'pulou'] as const;
export type OnboardingAction = (typeof ONBOARDING_ACTIONS)[number];

export class LogOnboardingEventDto {
  @ApiProperty({ example: 2, description: 'Passo do fluxo (1..5)' })
  @IsInt()
  @Min(1)
  @Max(5)
  step: number;

  @ApiProperty({ enum: ONBOARDING_ACTIONS, example: 'concluiu' })
  @IsIn(ONBOARDING_ACTIONS as unknown as string[])
  action: OnboardingAction;
}
