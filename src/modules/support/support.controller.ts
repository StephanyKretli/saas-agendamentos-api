import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Ajuste o caminho para o seu Guard

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @UseGuards(JwtAuthGuard) // 🔒 Só utilizadores logados podem enviar
  @Post('feedback')
  async submitFeedback(@Request() req, @Body() body: CreateFeedbackDto) {
    // Pega o ID do utilizador através do Token JWT
    const userId = req.user.id || req.user.sub;
    
    return this.supportService.sendFeedback(userId, body);
  }
}