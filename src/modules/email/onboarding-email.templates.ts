// Régua de dois e-mails de retomada do onboarding (/onboarding).
// Só isto: trazer a pessoa de volta pra terminar o link. Sem venda, sem preço.
//
// Copy fixa (não editar sem alinhar com a Stephany — é a voz dela):
//   E-mail 1 (D+20min): "Seu link está a 3 minutos de ficar pronto"
//   E-mail 2 (D+2 dias): "Seu link do Syncro ainda está vazio"

export type OnboardingEmailStep = 1 | 2;

export interface OnboardingEmailVars {
  /** Primeira palavra do nome, já higienizada — ou null se o nome for lixo. */
  firstName: string | null;
  /** Botão dos dois e-mails: sempre /onboarding. */
  ctaUrl: string;
  /** Rodapé de descadastro (GET /trial-touches/opt-out/:userId). */
  optOutUrl: string;
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

function ctaButton(url: string): string {
  return `<div style="margin:28px 0;">
    <a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px;">Terminar meu link &rarr;</a>
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

export function renderOnboardingEmail(
  step: OnboardingEmailStep,
  v: OnboardingEmailVars,
): { subject: string; html: string } {
  const g = greeting(v.firstName);

  if (step === 1) {
    return {
      subject: 'Seu link está a 3 minutos de ficar pronto',
      html: shell(
        `<p style="margin:0 0 16px;">${g}</p>
         <p style="margin:0 0 16px;">Vi que você começou a criar sua conta no Syncro e parou no meio. Sem problema — falta pouco.</p>
         <p style="margin:0 0 16px;">São três perguntas: qual serviço você mais faz, quanto custa e em que horários você atende. No fim disso você tem um link pronto para colar na bio do Instagram, e suas clientes conseguem marcar horário sozinhas.</p>
         ${ctaButton(v.ctaUrl)}
         <p style="margin:0;color:#71717a;font-size:13px;">Leva menos tempo que responder este e-mail.</p>
         ${SIGNATURE}`,
        v.optOutUrl,
      ),
    };
  }

  return {
    subject: 'Seu link do Syncro ainda está vazio',
    html: shell(
      `<p style="margin:0 0 16px;">${g}</p>
       <p style="margin:0 0 16px;">Seu link ainda não tem nenhum serviço cadastrado, então quem abrir não consegue marcar nada.</p>
       <p style="margin:0 0 16px;">Se você travou em alguma parte, me responde este e-mail dizendo onde — eu leio todas e conserto o que estiver confuso. E se não for o momento, tudo bem também: sua conta expira sozinha, você não precisa fazer nada.</p>
       ${ctaButton(v.ctaUrl)}
       ${SIGNATURE}`,
      v.optOutUrl,
    ),
  };
}
