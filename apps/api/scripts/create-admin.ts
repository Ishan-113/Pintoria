/* Creates (or resets) the first Printoria Admin user. Safe to run repeatedly.
 * Usage:
 *   npm run create-admin -- --email admin@printoria.example --name "Printoria Admin" [--password "..."]
 * If --password is omitted a strong random password is generated and printed once.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      out[key] = next;
      if (next !== 'true') i++;
    }
  }
  return out;
}

function validatePassword(pw: string): string | null {
  if (pw.length < 10) return 'at least 10 characters';
  if (!/[a-z]/.test(pw)) return 'a lower-case letter';
  if (!/[A-Z]/.test(pw)) return 'an upper-case letter';
  if (!/[0-9]/.test(pw)) return 'a digit';
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim().toLowerCase();
  const name = args.name?.trim() || 'Printoria Admin';
  const password = args.password || (await import('crypto')).randomBytes(12).toString('base64url');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run create-admin -- --email you@example.com --name "Name" [--password "P@ssw0rd"]');
    process.exit(1);
  }
  const pwProblem = validatePassword(password);
  if (pwProblem) {
    console.error(`Password needs ${pwProblem}.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { fullName: name, passwordHash, role: 'PRINTORIA_ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    console.log(`Existing user ${email} reset to PRINTORIA_ADMIN.`);
  } else {
    await prisma.user.create({
      data: { email, fullName: name, passwordHash, role: 'PRINTORIA_ADMIN', status: 'ACTIVE' },
    });
    console.log(`Printoria Admin created: ${email}`);
  }

  if (args.password) {
    console.log('Password was provided on the command line.');
  } else {
    console.log(`Password (shown once): ${password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
