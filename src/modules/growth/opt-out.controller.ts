import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

// Link público de saída fácil. `optOut` é GLOBAL: vale pra régua de WhatsApp
// (T11, T16) E pra régua de e-mail de onboarding — este é o link do rodapé
// dos dois. GET de propósito (não POST): precisa funcionar como link clicável
// direto no WhatsApp/e-mail, sem JS nem formulário. Sem auth: é um unsubscribe
// — o pior caso de abuso é alguém desativar a régua de outra pessoa, não um
// risco de dado sensível.
@Controller('trial-touches')
export class OptOutController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('opt-out/:userId')
  async optOut(@Param('userId') userId: string, @Res() res: Response) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { optOut: true, optOutAt: new Date() },
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Syncro</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background:#09090b; color:#fafafa; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; text-align:center;">
<div>
<h1 style="font-size:1.25rem; margin-bottom:8px;">Pronto.</h1>
<p style="color:#a1a1aa; margin:0;">Você não vai mais receber mensagens do Syncro.</p>
</div>
</body>
</html>`);
  }
}
