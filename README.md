# 📅 SaaS Agendamentos - API (Backend)

<p align="left">
  <a href="http://nestjs.com/" target="blank"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" /></a>
  <a href="https://www.typescriptlang.org/" target="blank"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/" target="blank"><img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

## 📖 Sobre o Projeto
Esta é a API RESTful construída para o SaaS de Agendamentos Online. Ela gerencia toda a lógica de negócios, autenticação, controle de serviços, clientes e disponibilidade de horários. Construída sobre o framework **NestJS**, a aplicação foca em escalabilidade, tipagem forte e respostas padronizadas.

## 🚀 Tecnologias e Arquitetura
* **Framework:** NestJS (Node.js)
* **Linguagem:** TypeScript
* **Padronização de Respostas:** Utiliza `TransformInterceptor` para garantir que todo sucesso retorne no formato `{ data: ... }`.
* **Tratamento de Erros:** Utiliza `AllExceptionsFilter` para capturar exceções globais e retornar mensagens consistentes para o frontend.

## ⚙️ Configuração Local

1. Clone o repositório e instale as dependências:
\`\`\`bash
npm install
\`\`\`

2. Crie um arquivo `.env` na raiz do projeto com base no seu ambiente. Exemplo:
\`\`\`env
PORT=3333
DATABASE_URL="sua_string_de_conexao_com_o_banco"
JWT_SECRET="sua_chave_secreta"
\`\`\`

3. Inicie o servidor em modo de desenvolvimento:
\`\`\`bash
npm run start:dev
\`\`\`

A API estará disponível em `http://localhost:3333`.
