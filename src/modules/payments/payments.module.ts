import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercado-pago.service';
import { AsaasService } from './asaas.service'; 
import { BillingController } from './billing.controller';
@Module({
  providers: [MercadoPagoService, AsaasService], 
  exports: [MercadoPagoService, AsaasService], 
  controllers: [BillingController], 
})
export class PaymentsModule {}