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
      useFactory: async (): Promise<JwtModuleOptions> => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error(
            'JWT_SECRET nao configurada. Defina a variavel de ambiente antes de subir a API.',
          );
        }
        return {
        secret,
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as SignOptions['expiresIn'],
        },
        };
      },
    }),
    PaymentsModule, 
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, GoogleStrategy ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}