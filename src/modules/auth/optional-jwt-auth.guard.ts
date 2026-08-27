import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Igual ao JwtAuthGuard, mas nunca bloqueia a rota: sem token ou token
// inválido, req.user fica undefined e a requisição segue como anônima.
// Usado nas rotas públicas de booking pra saber SE a visitante é a própria
// dona logada (sem exigir login pra visitante de verdade poder agendar).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || undefined;
  }
}
