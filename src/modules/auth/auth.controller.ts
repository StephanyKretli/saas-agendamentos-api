import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Body, Controller, Get, Post, Query, Req, Res, UseGuards, Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
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
  register(@Body() dto: RegisterDto, @Req() req: any) {
    // IP só é usado pra comprovar o opt-in do WhatsApp (LGPD/Meta) se ela
    // marcar a caixa — ver register() no service.
    //
    // A VPS tem um unico Nginx na frente, sem CDN. Config padrao do Nginx usa
    // $proxy_add_x_forwarded_for, que ACRESCENTA o peer ao XFF que veio do
    // cliente em vez de substituir — pegar o primeiro valor (split(',')[0])
    // pega exatamente o que um cliente malicioso forjou. O IP real e o
    // ULTIMO valor da lista.
    //
    // X-Real-IP tambem e um header que o cliente pode mandar — só e confiavel
    // se o Nginx estiver sobrescrevendo, e isso ainda NAO foi confirmado.
    // Ate confirmar, XFF.pop() vem primeiro: no cenario padrao (Nginx so seta
    // XFF, sem X-Real-IP) ele ja acerta; e se um atacante mandar um
    // X-Real-IP forjado sem o Nginx sobrescrever, ele nao teria prioridade
    // sobre o XFF de qualquer forma. Só promova X-Real-IP pra frente depois
    // de confirmar via `grep proxy_set_header` que o Nginx o define.
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',').pop()?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.ip;
    return this.authService.register(dto, ip);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    // ✅ Corrigido para chamar o service
    return this.authService.login(dto);
  }

  // Público (usado no debounce do passo 1 do onboarding e no cadastro).
  // Throttle próprio, mais apertado que o global, por ser sem auth.
  @Get('username-available')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  checkUsername(@Query('u') u: string) {
    return this.authService.checkUsernameAvailable(u ?? '');
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