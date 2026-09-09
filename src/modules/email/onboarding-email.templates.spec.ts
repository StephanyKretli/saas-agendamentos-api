import {
  firstNameFromRaw,
  renderOnboardingEmail,
  renderPostOnboardingEmail,
} from './onboarding-email.templates';

describe('onboarding-email.templates', () => {
  describe('firstNameFromRaw', () => {
    it.each([
      ['Stephany Kretli', 'Stephany'],
      ['Fulano undefined', 'Fulano'],
      ['daniellx42 undefined', 'daniellx42'],
      ['  Maria  ', 'Maria'],
    ])('%p → %p', (input, expected) => {
      expect(firstNameFromRaw(input)).toBe(expected);
    });

    it.each([
      ['undefined'],
      [''],
      ['   '],
      ['undefined undefined'],
      [null],
      [undefined],
      ['42'],
      ['-'],
    ])('lixo %p → null', (input) => {
      expect(firstNameFromRaw(input as any)).toBeNull();
    });
  });

  describe('renderOnboardingEmail', () => {
    const vars = {
      ctaUrl: 'https://meusyncro.com.br/onboarding',
      optOutUrl: 'https://api.meusyncro.com.br/trial-touches/opt-out/u1',
      hasService: true,
      hasBusinessHour: true,
    };

    it('e-mail 1: assunto exato, saudação com nome, botão pra /onboarding e link de opt-out', () => {
      const { subject, html } = renderOnboardingEmail(1, {
        ...vars,
        firstName: 'Ana',
      });
      expect(subject).toBe('Seu link está a 3 minutos de ficar pronto');
      expect(html).toContain('Oi, Ana!');
      expect(html).toContain('href="https://meusyncro.com.br/onboarding"');
      expect(html).toContain('Terminar meu link');
      expect(html).toContain(vars.optOutUrl);
      expect(html).toContain('Leva menos tempo que responder este e-mail.');
    });

    it('e-mail 1: a descrição dos passos bate com as 4 telas reais de /onboarding', () => {
      const { html } = renderOnboardingEmail(1, { ...vars, firstName: 'Ana' });
      expect(html).toContain('quatro telas');
      expect(html).toContain('endereço no Syncro');
      expect(html).toContain('serviço');
      expect(html).toContain('horários');
      expect(html).not.toContain('três perguntas');
    });

    it('e-mail 2: assunto novo (verdadeiro nos 3 casos) e pedido de resposta', () => {
      const { subject, html } = renderOnboardingEmail(2, {
        ...vars,
        firstName: 'Ana',
      });
      expect(subject).toBe('Seu link do Syncro ainda não está no ar');
      expect(html).toContain('me responde este e-mail');
      // parágrafo que não pode sumir
      expect(html).toContain('sua conta expira sozinha, você não precisa fazer nada');
    });

    it('e-mail 2: sem serviço → frase do serviço', () => {
      const { html, text } = renderOnboardingEmail(2, {
        ...vars,
        firstName: 'Ana',
        hasService: false,
        hasBusinessHour: false,
      });
      const frase =
        'Seu link ainda não tem nenhum serviço cadastrado, então quem abrir não consegue marcar nada.';
      expect(html).toContain(frase);
      expect(text).toContain(frase);
    });

    it('e-mail 2: com serviço e sem horário → frase do horário', () => {
      const { html, text } = renderOnboardingEmail(2, {
        ...vars,
        firstName: 'Ana',
        hasService: true,
        hasBusinessHour: false,
      });
      const frase =
        'Seu link já tem serviço, mas nenhum horário de atendimento — quem abrir não encontra nenhuma data livre.';
      expect(html).toContain(frase);
      expect(text).toContain(frase);
    });

    it('e-mail 2: com serviço e horário → frase curta', () => {
      const { html } = renderOnboardingEmail(2, {
        ...vars,
        firstName: 'Ana',
        hasService: true,
        hasBusinessHour: true,
      });
      expect(html).toContain('Falta pouco para seu link ficar pronto.');
      expect(html).not.toContain('nenhum serviço cadastrado');
      expect(html).not.toContain('nenhum horário de atendimento');
    });

    it('nome nulo → "Oi!" e NUNCA "undefined"/"null" no corpo', () => {
      for (const step of [1, 2] as const) {
        const { html } = renderOnboardingEmail(step, {
          ...vars,
          firstName: null,
        });
        expect(html).toContain('Oi!');
        expect(html).not.toMatch(/undefined|null/i);
      }
    });

    it('nome com HTML é escapado (não injeta markup)', () => {
      const { html } = renderOnboardingEmail(1, {
        ...vars,
        firstName: '<b>x',
      });
      expect(html).not.toContain('<b>x');
      expect(html).toContain('&lt;b&gt;x');
    });

    it('e-mails 1 e 2 têm versão text/plain não vazia, sem tags, com a URL do CTA legível', () => {
      for (const step of [1, 2] as const) {
        const { text } = renderOnboardingEmail(step, {
          ...vars,
          firstName: 'Ana',
        });
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
        expect(text).toContain('https://meusyncro.com.br/onboarding');
        expect(text).toContain(vars.optOutUrl);
      }
    });
  });

  describe('renderPostOnboardingEmail', () => {
    const vars = {
      publicUrl: 'https://meusyncro.com.br/book/studio-ana',
      optOutUrl: 'https://api.meusyncro.com.br/trial-touches/opt-out/u1',
    };

    // Trecho da legenda pronta com a URL no meio da frase. Só bate como
    // substring literal se a URL estiver como TEXTO — um <a href>URL</a> quebra
    // o casamento exato.
    const legendaComUrl = `sem precisar esperar eu responder: ${vars.publicUrl} — você escolhe o horário que está livre e pronto. 🖤`;

    it('assunto exato, saudação, URL pública, frase do "só seu" e legenda pronta no HTML', () => {
      const { subject, html } = renderPostOnboardingEmail({
        ...vars,
        firstName: 'Ana',
      });
      expect(subject).toBe(
        'Seu link está pronto. Falta ele aparecer em algum lugar.',
      );
      expect(html).toContain('Oi, Ana!');
      expect(html).toContain('Ver meu link');
      expect(html).toContain(vars.publicUrl);
      expect(html).toContain(
        'Ele é só seu — nenhum outro salão pode usar esse nome. Funciona igual ao @ do Instagram.',
      );
      expect(html).toContain(legendaComUrl);
      expect(html).toContain(vars.optOutUrl);
    });

    it('a URL dentro da legenda não está dentro de uma tag <a>', () => {
      const { html } = renderPostOnboardingEmail({ ...vars, firstName: 'Ana' });
      // o bloco da legenda: da abertura de aspas até o </div> seguinte
      const inicio = html.indexOf('"Agora dá pra marcar comigo');
      const fim = html.indexOf('</div>', inicio);
      expect(inicio).toBeGreaterThan(-1);
      const blocoLegenda = html.slice(inicio, fim);
      expect(blocoLegenda).toContain(vars.publicUrl);
      expect(blocoLegenda).not.toMatch(/<a\b/i);
    });

    it('nome nulo → "Oi!" e nunca "undefined"/"null"', () => {
      const { html } = renderPostOnboardingEmail({ ...vars, firstName: null });
      expect(html).toContain('Oi!');
      expect(html).not.toMatch(/undefined|null/i);
    });

    it.each([
      ['Fulano undefined', 'Oi, Fulano!'],
      ['SYNCRO undefined', 'Oi, SYNCRO!'],
    ])(
      'nome lixo %p → saudação atual (%p), sem "undefined" no corpo',
      (raw, esperado) => {
        const { html } = renderPostOnboardingEmail({
          ...vars,
          firstName: firstNameFromRaw(raw),
        });
        expect(html).toContain(esperado);
        expect(html).not.toMatch(/undefined|null/i);
      },
    );

    it('versão text/plain não vazia, sem tags, com legenda e URL pública por extenso', () => {
      const { text } = renderPostOnboardingEmail({ ...vars, firstName: 'Ana' });
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
      expect(text).toContain(vars.publicUrl);
      expect(text).toContain(legendaComUrl);
      expect(text).toContain(vars.optOutUrl);
      expect(text).toContain('🖤');
    });
  });
});
