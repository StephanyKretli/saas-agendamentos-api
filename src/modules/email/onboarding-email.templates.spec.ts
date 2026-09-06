import {
  firstNameFromRaw,
  renderOnboardingEmail,
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

    it('e-mail 2: assunto exato e pedido de resposta', () => {
      const { subject, html } = renderOnboardingEmail(2, {
        ...vars,
        firstName: 'Ana',
      });
      expect(subject).toBe('Seu link do Syncro ainda está vazio');
      expect(html).toContain('me responde este e-mail');
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
      const { html } = renderOnboardingEmail(1, { ...vars, firstName: '<b>x' });
      expect(html).not.toContain('<b>x');
      expect(html).toContain('&lt;b&gt;x');
    });
  });
});
