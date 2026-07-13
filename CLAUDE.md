# Syncro Backend (API)

## Stack e Arquitetura Back
- Node.js, NestJS, Prisma ORM, PostgreSQL.

## Regras de Desenvolvimento Backend
1. **Padrão NestJS:** Mantenha a separação de responsabilidades (Controllers para rotas, Services para lógica de negócio).
2. **Filtro Multi-tenant Obrigatório:** Toda busca (findMany, findFirst, update) no Prisma DEVE incluir o `tenantId` da requisição autenticada.
3. **Validação de Payload:** Use DTOs estritos com `class-validator` para todas as entradas de dados.
4. **Integrações Externas:** 
   - **Mercado Pago:** Trate falhas de comunicação com resiliência (try/catch). A geração e validação do Access Token é sensível.
   - **Evolution API (WhatsApp):** O formato do JSON de disparo de mensagens não deve ser formatado ou compactado de forma a quebrar o webhook.

## Comandos do Backend
- Lembre-se de rodar `npx prisma migrate dev` e gerar o client ao alterar o `schema.prisma`.