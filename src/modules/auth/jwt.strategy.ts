import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

// Falha explicitamente no boot se o segredo nao estiver configurado.
// Antes havia um fallback para 'dev_secret': se a env var faltasse em
// producao (ex.: Docker sem ler o .env), qualquer pessoa poderia forjar
// um JWT valido para qualquer usuario.
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET nao configurada. Defina a variavel de ambiente antes de subir a API — ' +
        'sem ela nao ha como assinar/validar tokens com seguranca.',
    );
  }
  return secret;
}

const JWT_SECRET = requireJwtSecret();

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  validate(payload: { sub: string; email: string; role: string }) {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
