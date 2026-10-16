import bcrypt from 'bcryptjs';
import type { Db } from './db.ts';

// Demo accounts so anyone trying the APK can log in straight away.
export const DEMO = {
  admin: { name: 'Campus Admin', email: 'admin@proxyproof.dev', password: 'admin1234' },
  organiser: { name: 'Dr. Meera Nair', email: 'organiser@proxyproof.dev', password: 'demo1234' },
  course: { name: 'Operating Systems', code: 'CS301', joinCode: 'OSDEMO' },
};

export async function seedDemo(db: Db) {
  const upsertUser = async (u: { name: string; email: string; password: string }, role: string) => {
    const { rows: [existing] } = await db.query('SELECT id FROM users WHERE email = $1', [u.email]);
    if (existing) return existing.id as string;
    const { rows: [created] } = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [u.name, u.email, await bcrypt.hash(u.password, 10), role]);
    return created.id as string;
  };

  await upsertUser(DEMO.admin, 'admin');
  const organiserId = await upsertUser(DEMO.organiser, 'organiser');
  await db.query(
    `INSERT INTO courses (name, code, join_code, organiser_id) VALUES ($1, $2, $3, $4) ON CONFLICT (join_code) DO NOTHING`,
    [DEMO.course.name, DEMO.course.code, DEMO.course.joinCode, organiserId]);
}

// `npm run seed` against whatever DATABASE_URL / PGLITE_DIR points at.
if (process.argv[1]?.endsWith('seed.ts')) {
  const { createDb } = await import('./db.ts');
  const db = await createDb();
  await seedDemo(db);
  console.log('Demo data ready:');
  console.log(`  organiser  ${DEMO.organiser.email} / ${DEMO.organiser.password}`);
  console.log(`  admin      ${DEMO.admin.email} / ${DEMO.admin.password}`);
  console.log(`  course     ${DEMO.course.code}, join code ${DEMO.course.joinCode}`);
  await db.close();
}
