import { Global, Module } from '@nestjs/common';
import { MercadoPagoService } from './mercado-pago.service';
import { PaymentsController } from './payments.controller';

@Global()
@Module({
  controllers: [PaymentsController], 
  providers: [MercadoPagoService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}