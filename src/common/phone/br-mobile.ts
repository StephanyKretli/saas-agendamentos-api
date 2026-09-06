/**
 * Variantes de um celular brasileiro para consultar na Evolution (endpoint
 * /chat/whatsappNumbers): com e sem o nono dígito, sempre com DDI 55.
 *
 * Números móveis podem estar gravados de qualquer jeito — com ou sem 55, com
 * ou sem o 9. Mandamos as duas formas na mesma chamada e aceitamos a que a
 * Evolution disser que existe.
 *
 * Retorna `[]` se não sobrar dígito utilizável.
 */
export function brMobileVariants(raw: string): string[] {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return [];

  // Normaliza: tira o 55 do começo (se claramente for DDI) pra reanexar depois.
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Fora do padrão BR (DDD de 2 + 8 ou 9 dígitos): manda o que tiver, com 55.
  if (digits.length < 10 || digits.length > 11) {
    return [`55${digits}`];
  }

  const ddd = digits.slice(0, 2);
  const local = digits.slice(2); // 8 ou 9 dígitos

  const temNove = local.length === 9 && local.startsWith('9');
  const com9 = temNove ? local : local.length === 8 ? `9${local}` : local;
  const sem9 = temNove ? local.slice(1) : local;

  return [...new Set([`55${ddd}${com9}`, `55${ddd}${sem9}`])];
}
