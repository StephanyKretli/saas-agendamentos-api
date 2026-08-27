import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// S0 não existe na prática: o username (slug do /book/) é obrigatório no
// cadastro, então toda conta já nasce em S1. S4 (cliente confirmou o
// lembrete) também não entra aqui: hoje não existe fluxo de confirmação de
// lembrete no produto (os lembretes são só envio, sem retorno) — ver
// REGUA_RELACIONAMENTO_WHATSAPP.md, achado 3. Cobrir S4 é feature nova, não
// leitura de estado.
export type ActivationState = 'S1' | 'S2' | 'S3' | 'S5';

export interface ActivationSnapshot {
  state: ActivationState;
  resfriando: boolean; // sem nenhum evento no produto há 72h+
  diasDesdeCadastro: number;
  horasDesdeUltimoEvento: number;
  nProfissionais: number;
  temSinalPix: boolean;
}

const RESFRIANDO_HORAS = 72;

@Injectable()
export class ActivationStateService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(tenantId: string): Promise<ActivationSnapshot> {
    const [user, anyBookings, nProfissionais] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: tenantId },
        select: { createdAt: true, requirePixDeposit: true, lastProductEventAt: true, activatedAt: true },
      }),
      this.prisma.appointment.count({
        where: { userId: tenantId, status: { not: 'CANCELED' } },
      }),
      this.prisma.user.count({
        where: { OR: [{ id: tenantId }, { ownerId: tenantId }] },
      }),
    ]);

    if (!user) throw new Error(`Tenant não encontrado: ${tenantId}`);

    let state: ActivationState;
    // S3 é um marco definitivo (activatedAt), não uma contagem ao vivo: se a
    // única cliente real cancelar depois, ela continua "já provada" — ver
    // REGUA_RELACIONAMENTO_WHATSAPP.md §3 ("S3 · Nada — provar de novo").
    if (user.activatedAt) {
      state = 'S3';
      // S5 · "expandida": sinal PIX ligado ou 2+ profissionais com comissão rodando.
      if (user.requirePixDeposit || nProfissionais >= 2) state = 'S5';
    } else if (anyBookings > 0) {
      state = 'S2'; // ela mesma lançou pelo link/dashboard, mas nenhuma cliente real marcou ainda
    } else {
      state = 'S1'; // link já existe desde o cadastro, agenda ainda vazia
    }

    // Sem nenhum evento registrado ainda (conta antiga a esta coluna, ou
    // nunca criou agendamento), usa o próprio cadastro como última atividade
    // conhecida — senão toda conta pré-existente aparece como "nunca esfria".
    const ultimaAtividade = user.lastProductEventAt ?? user.createdAt;
    const horasDesdeUltimoEvento = (Date.now() - ultimaAtividade.getTime()) / (60 * 60 * 1000);

    const diasDesdeCadastro = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      state,
      resfriando: horasDesdeUltimoEvento > RESFRIANDO_HORAS,
      diasDesdeCadastro,
      horasDesdeUltimoEvento,
      nProfissionais,
      temSinalPix: user.requirePixDeposit,
    };
  }
}
