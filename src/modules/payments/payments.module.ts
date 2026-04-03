import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercado-pago.service';
import { AsaasService } from './asaas.service'; 
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
@Module({
  providers: [MercadoPagoService, AsaasService, BillingService],
  exports: [MercadoPagoService, AsaasService], 
  controllers: [BillingController], 
})
export class PaymentsModule {}