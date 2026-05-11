import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

// O @Catch diz ao NestJS: "Fique de olho em TODOS os erros que vierem do Prisma"
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Tratamento para P2002: Unique constraint failed (Ex: Email ou Username duplicado)
    if (exception.code === 'P2002') {
      // O Prisma diz-nos qual foi o campo exato que duplicou (ex: ['email'])
      const target = exception.meta?.target as string[];
      const field = target && target.length > 0 ? target[0] : 'dado';

      // Montamos o JSON amigável igualzinho ao que o NestJS faz por padrão
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: `Este ${field} já está em uso. Por favor, utilize outro.`,
        error: 'Conflict',
      });
    }

    // Tratamento para P2025: Record not found (Tentou atualizar/deletar algo que não existe)
    if (exception.code === 'P2025') {
      return response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'O registro que tentou acessar não foi encontrado no sistema.',
        error: 'Not Found',
      });
    }

    // Fallback: Se for outro erro do Prisma que não mapeamos acima
    console.error('Erro Prisma não mapeado:', exception.message);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ocorreu um erro interno ao processar a operação no banco de dados.',
      error: 'Internal Server Error',
    });
  }
}