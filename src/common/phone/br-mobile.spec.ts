import { brMobileVariants } from './br-mobile';

describe('brMobileVariants', () => {
  it('11 dígitos (DDD + 9 + 8): gera com e sem o nono dígito, com DDI 55', () => {
    expect(brMobileVariants('11999998888')).toEqual(['5511999998888', '551199998888']);
  });

  it('8 dígitos locais (sem nono): gera a variante com 9 também', () => {
    expect(brMobileVariants('1133334444')).toEqual(['5511933334444', '551133334444']);
  });

  it('já com DDI 55 e nono dígito (13 dígitos — o caso do BarberShop Maceió)', () => {
    expect(brMobileVariants('5582988071425')).toEqual(['5582988071425', '558288071425']);
  });

  it('máscara com pontuação é limpa antes', () => {
    expect(brMobileVariants('(11) 99999-8888')).toEqual(['5511999998888', '551199998888']);
  });

  it('vazio / sem dígito → []', () => {
    expect(brMobileVariants('')).toEqual([]);
    expect(brMobileVariants('abc')).toEqual([]);
  });

  it('fora do padrão BR (curto/longo demais): manda uma variante só, com 55', () => {
    expect(brMobileVariants('12345')).toEqual(['5512345']);
  });
});
