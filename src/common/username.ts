import { PrismaService } from '../prisma/prisma.service';

/**
 * Slug canônico do username público usado em /book/{slug}.
 * Mesma regra do front (register/page.tsx): minúsculas, sem acento, hífen no
 * lugar de espaço/símbolo, sem hífen nas pontas nem repetido, no máx. 30 chars.
 */
export function slugifyUsername(raw: string): string {
  return (raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove marcas de acento decompostas
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** true se o slug tem tamanho mínimo e ninguém está usando. */
export async function isUsernameAvailable(
  prisma: PrismaService,
  candidate: string,
): Promise<boolean> {
  const slug = slugifyUsername(candidate);
  if (slug.length < 3) return false;
  const existing = await prisma.user.findUnique({
    where: { username: slug },
    select: { id: true },
  });
  return !existing;
}

/**
 * Devolve `base` slugificado se estiver livre; senão `base-2`, `base-3`... até
 * achar um livre. Usado tanto pela sugestão do passo 1 do onboarding quanto
 * pelo login Google (onde `email.split('@')[0]` colide e estoura P2002).
 */
export async function suggestAvailableUsername(
  prisma: PrismaService,
  base: string,
  maxAttempts = 50,
): Promise<string> {
  let slug = slugifyUsername(base);
  if (slug.length < 3) slug = `salao-${slug}`.slice(0, 30) || 'salao';

  const rows = await prisma.user.findMany({
    where: { username: { startsWith: slug } },
    select: { username: true },
  });
  const taken = new Set(rows.map((r) => r.username));

  if (!taken.has(slug)) return slug;

  for (let i = 2; i < maxAttempts + 2; i++) {
    const suffix = `-${i}`;
    const candidate = `${slug.slice(0, 30 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Cenário patológico (50+ colisões): cai num sufixo único por timestamp.
  const suffix = `-${Date.now().toString(36)}`;
  return `${slug.slice(0, 30 - suffix.length)}${suffix}`;
}
