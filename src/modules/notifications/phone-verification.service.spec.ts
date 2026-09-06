import { WhatsappService } from './whatsapp.service';
import { PhoneVerificationService } from './phone-verification.service';

describe('WhatsappService.checkWhatsappNumber (Evolution)', () => {
  let service: WhatsappService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsappService();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function resposta(body: any, ok = true, status = 200) {
    return Promise.resolve({ ok, status, json: async () => body });
  }

  it('Evolution diz exists:true → { exists: true, jid } com o JID canônico', async () => {
    fetchMock.mockReturnValue(
      resposta([{ exists: true, jid: '5511999998888@s.whatsapp.net', number: '5511999998888' }]),
    );

    const res = await service.checkWhatsappNumber('11999998888');

    expect(res).toEqual({ exists: true, jid: '5511999998888@s.whatsapp.net' });
    // mandou as duas variantes de nono dígito na mesma chamada
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.numbers).toEqual(['5511999998888', '551199998888']);
  });

  it('nenhuma variante existe → { exists: false, jid: null } (resultado conclusivo)', async () => {
    fetchMock.mockReturnValue(
      resposta([
        { exists: false, number: '5582988071425' },
        { exists: false, number: '558288071425' },
      ]),
    );

    const res = await service.checkWhatsappNumber('82988071425');
    expect(res).toEqual({ exists: false, jid: null });
  });

  it('aceita a variante que existir quando só uma tem WhatsApp', async () => {
    fetchMock.mockReturnValue(
      resposta([
        { exists: false, number: '558288071425' },
        { exists: true, jid: '5582988071425@s.whatsapp.net', number: '5582988071425' },
      ]),
    );

    const res = await service.checkWhatsappNumber('82988071425');
    expect(res).toEqual({ exists: true, jid: '5582988071425@s.whatsapp.net' });
  });

  it('Evolution 500 → { exists: null } (fail-open, nunca false) + log de erro', async () => {
    const errSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    fetchMock.mockReturnValue(resposta('boom', false, 500));

    const res = await service.checkWhatsappNumber('11999998888');

    expect(res).toEqual({ exists: null, jid: null });
    expect(errSpy).toHaveBeenCalled();
  });

  it('timeout / Evolution fora (fetch rejeita) → { exists: null } + log, nunca lança', async () => {
    const errSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(service.checkWhatsappNumber('11999998888')).resolves.toEqual({
      exists: null,
      jid: null,
    });
    expect(errSpy).toHaveBeenCalled();
  });

  it('corpo inesperado (sem lista) → { exists: null }', async () => {
    fetchMock.mockReturnValue(resposta({ status: 'ok' }));
    const errSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(service.checkWhatsappNumber('11999998888')).resolves.toEqual({
      exists: null,
      jid: null,
    });
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('PhoneVerificationService.verifyAndPersist', () => {
  let service: PhoneVerificationService;
  let whatsapp: any;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    whatsapp = { checkWhatsappNumber: jest.fn() };
    prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    service = new PhoneVerificationService(whatsapp, prisma);
  });

  it('exists:true → grava os 3 campos (bool, jid, checkedAt)', async () => {
    whatsapp.checkWhatsappNumber.mockResolvedValue({
      exists: true,
      jid: '5511999998888@s.whatsapp.net',
    });

    await service.verifyAndPersist('u1', '11999998888');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        whatsappNumberExists: true,
        whatsappJid: '5511999998888@s.whatsapp.net',
        whatsappCheckedAt: expect.any(Date),
      },
    });
  });

  it('exists:false → grava bool false e JID null', async () => {
    whatsapp.checkWhatsappNumber.mockResolvedValue({ exists: false, jid: null });

    await service.verifyAndPersist('u1', '82988071425');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        whatsappNumberExists: false,
        whatsappJid: null,
        whatsappCheckedAt: expect.any(Date),
      },
    });
  });

  it('exists:null (inconclusivo) → NÃO grava nada (campo permanece "não verificado") + warn', async () => {
    whatsapp.checkWhatsappNumber.mockResolvedValue({ exists: null, jid: null });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.verifyAndPersist('u1', '11999998888');

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('telefone vazio → no-op, nem chama a Evolution', async () => {
    await service.verifyAndPersist('u1', '');
    await service.verifyAndPersist('u1', null);
    expect(whatsapp.checkWhatsappNumber).not.toHaveBeenCalled();
  });

  it('erro inesperado (prisma.update lança) é engolido — nunca propaga pro chamador', async () => {
    whatsapp.checkWhatsappNumber.mockResolvedValue({ exists: true, jid: 'x@w' });
    prisma.user.update.mockRejectedValue(new Error('db down'));
    const errSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

    await expect(service.verifyAndPersist('u1', '11999998888')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
