// Régua de e-mails de onboarding. Duas condições distintas:
//
//   Retomada (quem NÃO terminou /onboarding):
//     E-mail 1 (D+20min): "Seu link está a 3 minutos de ficar pronto"
//     E-mail 2 (D+2 dias): "Seu link do Syncro ainda não está no ar"
//
//   Pós-conclusão (quem terminou e ainda não teve cliente marcando):
//     EMAIL_POS_ONB_1 (concluído + 1 dia): "Seu link está pronto. Falta ele
//     aparecer em algum lugar."
//
// Copy fixa (não editar sem alinhar com a Stephany — é a voz dela).

export type OnboardingEmailStep = 1 | 2;

export interface OnboardingEmailVars {
  /** Primeira palavra do nome, já higienizada — ou null se o nome for lixo. */
  firstName: string | null;
  /** Botão dos e-mails 1 e 2: sempre /onboarding. */
  ctaUrl: string;
  /** Rodapé de descadastro (GET /trial-touches/opt-out/:userId). */
  optOutUrl: string;
  /**
   * Só o e-mail 2 usa: o que de fato já existe no link, para a frase de abertura
   * dizer a verdade sobre a conta (o filtro do cron só garante
   * onboardingCompletedAt = null, não "sem serviço").
   */
  hasService: boolean;
  hasBusinessHour: boolean;
}

export interface PostOnboardingEmailVars {
  firstName: string | null;
  /** Página pública de agendamento — {FRONTEND_URL}/book/{username}. */
  publicUrl: string;
  optOutUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  /**
   * Alternativa text/plain. Domínio de envio novo (verificado em 06/09/2026):
   * mensagem sem parte de texto pontua pior em filtro de spam. URL do CTA sempre
   * por extenso, sem tags.
   */
  text: string;
}

/**
 * Primeiro nome utilizável, ou null.
 *
 * O `User.name` vem sujo em produção: o caminho do Google OAuth monta
 * `${firstName} ${lastName}` sem tratar lastName vazio, gerando "Fulano
 * undefined", "SYNCRO undefined" e afins. Um e-mail que chama a pessoa de
 * "undefined" é pior que um sem nome — então, na dúvida, omite a saudação
 * personalizada e cai no "Oi!".
 */
export function firstNameFromRaw(
  raw: string | null | undefined,
): string | null {
  const cleaned = (raw ?? '')
    .replace(/\b(undefined|null)\b/gi, ' ') // remove os tokens de lixo do OAuth
    .trim();
  const first = cleaned.split(/\s+/)[0] ?? '';
  if (first.length < 2) return null; // "", "a", sobra de pontuação
  if (!/\p{L}/u.test(first)) return null; // sem nenhuma letra → não é nome
  return first;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}

function greeting(firstName: string | null): string {
  return firstName ? `Oi, ${escapeHtml(firstName)}!` : 'Oi!';
}

/** Saudação da versão texto — sem escape de HTML. */
function greetingText(firstName: string | null): string {
  return firstName ? `Oi, ${firstName}!` : 'Oi!';
}

function ctaButton(url: string, label: string): string {
  return `<div style="margin:28px 0;">
    <a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px;">${label} &rarr;</a>
  </div>`;
}

function shell(innerHtml: string, optOutUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#f4f4f5;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
      <tr><td style="padding:32px 28px;color:#18181b;font-size:15px;line-height:1.6;">
        ${innerHtml}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;border-top:1px solid #f4f4f5;color:#a1a1aa;font-size:12px;line-height:1.5;">
        Você recebeu este e-mail porque criou uma conta no Syncro.
        <a href="${optOutUrl}" style="color:#a1a1aa;text-decoration:underline;">Não quero mais receber</a>.
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}

const SIGNATURE = `<p style="margin:20px 0 0;">Stephany<br />Syncro</p>`;

/** Monta a versão texto: parágrafos + rodapé de descadastro por extenso. */
function textShell(paragraphs: string[], optOutUrl: string): string {
  return [
    ...paragraphs,
    'Stephany\nSyncro',
    '—',
    `Você recebeu este e-mail porque criou uma conta no Syncro. Para não receber mais: ${optOutUrl}`,
  ].join('\n\n');
}

/**
 * Frase de abertura do e-mail 2 — casa com o que REALMENTE falta na conta, em
 * vez de afirmar "não tem serviço" quando o filtro só olhou onboardingCompletedAt.
 */
function email2Opening(v: OnboardingEmailVars): string {
  if (!v.hasService) {
    return 'Seu link ainda não tem nenhum serviço cadastrado, então quem abrir não consegue marcar nada.';
  }
  if (!v.hasBusinessHour) {
    return 'Seu link já tem serviço, mas nenhum horário de atendimento — quem abrir não encontra nenhuma data livre.';
  }
  return 'Falta pouco para seu link ficar pronto.';
}

export function renderOnboardingEmail(
  step: OnboardingEmailStep,
  v: OnboardingEmailVars,
): RenderedEmail {
  const g = greeting(v.firstName);
  const gt = greetingText(v.firstName);

  if (step === 1) {
    // Descrição dos passos = as 4 telas reais de /onboarding (link, serviço +
    // preço, horários, link pronto). Se o fluxo mudar, este texto segue a tela.
    const passos =
      'São quatro telas curtas: você escolhe seu endereço no Syncro, cadastra o serviço que mais faz com o preço, marca os horários em que atende, e o link sai pronto. Você cola ele na bio do Instagram e suas clientes marcam horário sozinhas.';

    return {
      subject: 'Seu link está a 3 minutos de ficar pronto',
      html: shell(
        `<p style="margin:0 0 16px;">${g}</p>
         <p style="margin:0 0 16px;">Vi que você começou a criar sua conta no Syncro e parou no meio. Sem problema — falta pouco.</p>
         <p style="margin:0 0 16px;">${passos}</p>
         ${ctaButton(v.ctaUrl, 'Terminar meu link')}
         <p style="margin:0;color:#71717a;font-size:13px;">Leva menos tempo que responder este e-mail.</p>
         ${SIGNATURE}`,
        v.optOutUrl,
      ),
      text: textShell(
        [
          gt,
          'Vi que você começou a criar sua conta no Syncro e parou no meio. Sem problema — falta pouco.',
          passos,
          `Terminar meu link: ${v.ctaUrl}`,
          'Leva menos tempo que responder este e-mail.',
        ],
        v.optOutUrl,
      ),
    };
  }

  const abertura = email2Opening(v);

  return {
    subject: 'Seu link do Syncro ainda não está no ar',
    html: shell(
      `<p style="margin:0 0 16px;">${g}</p>
       <p style="margin:0 0 16px;">${abertura}</p>
       <p style="margin:0 0 16px;">Se você travou em alguma parte, me responde este e-mail dizendo onde — eu leio todas e conserto o que estiver confuso. E se não for o momento, tudo bem também: sua conta expira sozinha, você não precisa fazer nada.</p>
       ${ctaButton(v.ctaUrl, 'Terminar meu link')}
       ${SIGNATURE}`,
      v.optOutUrl,
    ),
    text: textShell(
      [
        gt,
        abertura,
        'Se você travou em alguma parte, me responde este e-mail dizendo onde — eu leio todas e conserto o que estiver confuso. E se não for o momento, tudo bem também: sua conta expira sozinha, você não precisa fazer nada.',
        `Terminar meu link: ${v.ctaUrl}`,
      ],
      v.optOutUrl,
    ),
  };
}

/**
 * E-mail de quem CONCLUIU o onboarding e ainda não teve cliente marcando.
 * Único objetivo: fazer o link aparecer na bio. Copy trazida do toque T3 da
 * régua de WhatsApp (whatsapp.service.ts / sendDivulgarLink) — escrita antes, na
 * voz da fundadora, e melhor: enquadra o link como identidade ("só seu, igual
 * ao @") e entrega a legenda pronta em vez de só explicar onde colar.
 * CTA aponta para a página pública (ver funcionando + copiar o endereço).
 *
 * A legenda pronta é um bloco destacado, em itálico, com a URL como TEXTO (não
 * dentro de <a>): quem seleciona e copia tem que levar o endereço escrito, não
 * um link mascarado. O 🖤 vem da voz dela — charset utf-8 nas duas versões.
 */
export function renderPostOnboardingEmail(
  v: PostOnboardingEmailVars,
): RenderedEmail {
  const g = greeting(v.firstName);
  const gt = greetingText(v.firstName);

  const legenda = `"Agora dá pra marcar comigo direto por aqui, sem precisar esperar eu responder: ${escapeHtml(
    v.publicUrl,
  )} — você escolhe o horário que está livre e pronto. 🖤"`;
  const legendaText = `"Agora dá pra marcar comigo direto por aqui, sem precisar esperar eu responder: ${v.publicUrl} — você escolhe o horário que está livre e pronto. 🖤"`;

  return {
    subject: 'Seu link está pronto. Falta ele aparecer em algum lugar.',
    html: shell(
      `<p style="margin:0 0 16px;">${g}</p>
       <p style="margin:0 0 12px;">Seu link de agendamento está no ar:</p>
       <p style="margin:0 0 16px;font-weight:700;word-break:break-all;">
         <a href="${v.publicUrl}" style="color:#18181b;">${escapeHtml(v.publicUrl)}</a>
       </p>
       <p style="margin:0 0 16px;">Ele é só seu — nenhum outro salão pode usar esse nome. Funciona igual ao @ do Instagram.</p>
       <p style="margin:0 0 12px;">Agora falta a parte que faz o Syncro trabalhar sozinho: colocar esse link na bio do Instagram e no seu status do WhatsApp. Se quiser, é só copiar:</p>
       <div style="margin:0 0 16px;padding:14px 16px;background:#f4f4f5;border-left:3px solid #d4d4d8;border-radius:8px;font-style:italic;color:#3f3f46;word-break:break-word;">
         ${legenda}
       </div>
       <p style="margin:0 0 16px;">Sua cliente não baixa nada e não cria senha.</p>
       ${ctaButton(v.publicUrl, 'Ver meu link')}
       <p style="margin:0;">Se travar em alguma parte, me responde este e-mail dizendo onde. Eu leio todas.</p>
       ${SIGNATURE}`,
      v.optOutUrl,
    ),
    text: textShell(
      [
        gt,
        'Seu link de agendamento está no ar:',
        v.publicUrl,
        'Ele é só seu — nenhum outro salão pode usar esse nome. Funciona igual ao @ do Instagram.',
        'Agora falta a parte que faz o Syncro trabalhar sozinho: colocar esse link na bio do Instagram e no seu status do WhatsApp. Se quiser, é só copiar:',
        legendaText,
        'Sua cliente não baixa nada e não cria senha.',
        'Se travar em alguma parte, me responde este e-mail dizendo onde. Eu leio todas.',
      ],
      v.optOutUrl,
    ),
  };
}
