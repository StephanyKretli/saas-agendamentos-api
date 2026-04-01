import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PaymentsModule } from '../payments/payments.module'; 
import { EmailService } from '../email/email.service';
import { GoogleStrategy } from './google.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: async (): Promise<JwtModuleOptions> => ({
        secret: process.env.JWT_SECRET ?? 'dev_secret',
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as SignOptions['expiresIn'],
        },
      }),
    }),
    PaymentsModule, 
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, GoogleStrategy ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}