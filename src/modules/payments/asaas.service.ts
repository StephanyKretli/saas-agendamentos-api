import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);
  private readonly apiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
  private readonly apiKey = process.env.ASAAS_API_KEY;

  // 1. Cria um Cliente no Asaas (Dona do Salão)
  async createCustomer(name: string, email: string, cpfCnpj?: string) {
    if (!this.apiKey || this.apiKey === 'sua_chave_sandbox_aqui') {
      this.logger.warn('ASAAS_API_KEY não configurada. Simulando criação de cliente...');
      return { id: `cus_simulated_${Date.now()}` };
    }

    try {
      const response = await fetch(`${this.apiUrl}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': this.apiKey,
        },
        body: JSON.stringify({
          name,
          email,
          cpfCnpj, 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error('Erro ao criar cliente no Asaas:', data);
        throw new Error(data.errors?.[0]?.description || 'Erro ao criar cliente no Asaas');
      }

      return data; // Retorna o objeto, onde data.id é o 'asaasCustomerId'
    } catch (error) {
      this.logger.error('Falha de comunicação com o Asaas', error);
      throw error;
    }
  }

  // 2. Cria a Assinatura (A mensalidade do plano)
  async createSubscription(customerId: string, value: number, cycle: 'MONTHLY' | 'YEARLY' = 'MONTHLY') {
    if (!this.apiKey || this.apiKey === 'sua_chave_sandbox_aqui') {
      this.logger.warn('ASAAS_API_KEY não configurada. Simulando assinatura...');
      return { id: `sub_simulated_${Date.now()}`, invoiceUrl: 'https://sandbox.asaas.com/simulacao' };
    }

    // A primeira cobrança vence hoje (ou amanhã)
    const nextDueDate = new Date();
    
    try {
      const response = await fetch(`${this.apiUrl}/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': this.apiKey,
        },
        body: JSON.stringify({
          customer: customerId,
          billingType: 'UNDEFINED', // Deixa o Asaas gerar um link onde o salão escolhe como quer pagar (Cartão ou PIX)
          value,
          nextDueDate: nextDueDate.toISOString().split('T')[0],
          cycle,
          description: 'Mensalidade - SaaS Agendamentos Premium',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error('Erro ao criar assinatura no Asaas:', data);
        throw new Error(data.errors?.[0]?.description || 'Erro ao criar assinatura no Asaas');
      }

      return {
        subscriptionId: data.id,           // Para guardarmos no nosso banco
        status: data.status,               // ACTIVE, PENDING, etc
      };
    } catch (error) {
      this.logger.error('Falha de comunicação com o Asaas', error);
      throw error;
    }
  }
}