import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => {
        // Se o dado já vier paginado com 'meta', preservamos a estrutura
        if (data && typeof data === 'object' && 'meta' in data && 'data' in data) {
          return data;
        }
        // Caso contrário, envelopamos no padrão { data: ... }
        return { data };
      }),
    );
  }
}