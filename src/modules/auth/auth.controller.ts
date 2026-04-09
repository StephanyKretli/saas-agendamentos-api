import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Body, Controller, Get, Post, Req, Res, UseGuards, Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

// 👇 Nova classe que força a escolha da conta para não dar erro no TypeScript
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    return {
      prompt: 'select_account',
    };
  }
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    // ✅ Corrigido para chamar o service
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    // ✅ Corrigido para chamar o service
    return this.authService.login(dto);
  }

  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    // req.user vem do JwtStrategy.validate()
    return req.user; // { id, email, role }
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    // ✅ Perfeito
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  async resetPassword(@Body() data: ResetPasswordDto) {
    // ✅ Perfeito
    return this.authService.resetPassword(data.token, data.password);
  }

  // 🌟 1. Esta rota redireciona o utilizador para a tela do Google
  @Get('google')
  // 👇 Usamos a nossa nova classe aqui (sem aspas) 👇
  @UseGuards(GoogleOAuthGuard)
  async googleAuth(@Req() req) {
    // O Passport cuida do redirecionamento
  }

  // 🌟 2. O Google devolve o utilizador para esta rota após aprovar
  @Get('google/callback')
  @UseGuards(AuthGuard('google')) // 👈 Este continua normal, sem o prompt
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    const result = await this.authService.validateOAuthLogin(req.user);
    
    // Como estamos no Backend, temos de redirecionar de volta para o Frontend (Next.js)
    // Passamos o token na URL para o Frontend conseguir guardá-lo
    
    // 🛡️ BÔNUS: Ajustado para a variável correta do seu .env (APP_WEB_URL)
    const frontendUrl = process.env.APP_WEB_URL || 'https://meusyncro.com.br';
    return res.redirect(`${frontendUrl}/auth/callback?token=${result.accessToken}`);
  }
}