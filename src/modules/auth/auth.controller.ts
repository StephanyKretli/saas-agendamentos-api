import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ResetPasswordDto } from './dto/reset-password.dto';

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
}