import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

/**
 * Verifica se o telefone de um usuário tem WhatsApp (via Evolution) e persiste
 * o resultado nos campos `whatsappNumberExists` / `whatsappJid` /
 * `whatsappCheckedAt` do User.
 *
 * É ASSÍNCRONA em relação ao fluxo que a chama (cadastro, Configurações):
 * dispare com `void`, nunca `await` bloqueando a resposta. NUNCA lança.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  async verifyAndPersist(
    userId: string,
    rawPhone: string | null | undefined,
  ): Promise<void> {
    try {
      if (!rawPhone || !String(rawPhone).replace(/\D/g, '')) return;

      const { exists, jid } = await this.whatsapp.checkWhatsappNumber(String(rawPhone));

      if (exists === null) {
        // Não conseguimos checar. NÃO grava nada — o campo continua null
        // ("não verificado"), distinto de false ("comprovadamente não tem").
        this.logger.warn(
          `Verificação de WhatsApp inconclusiva para userId=${userId} — ` +
            `campo permanece null (não verificado).`,
        );
        return;
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          whatsappNumberExists: exists,
          whatsappJid: jid,
          whatsappCheckedAt: new Date(),
        },
      });
      this.logger.log(
        `WhatsApp de userId=${userId}: exists=${exists}${jid ? ` jid=${jid}` : ''}`,
      );
    } catch (err) {
      // Fail-open absoluto: nada aqui pode derrubar o cadastro nem o settings.
      this.logger.error(
        `verifyAndPersist falhou para userId=${userId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
