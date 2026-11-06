/**
 * Seeds the skills taxonomy. Idempotent: safe to run on every deploy.
 * Run with `npm run db:seed` (uses DATABASE_URL from .env.local).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client';
import { parseSkillTaxonomy } from '../server/matching/skills';
import taxonomy from './seed-data/skills.json' with { type: 'json' };

config({ path: ['.env.local', '.env'], quiet: true });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const skills = parseSkillTaxonomy(taxonomy);
    let aliasCount = 0;

    for (const skill of skills) {
      const { id } = await db.skill.upsert({
        where: { canonicalName: skill.canonicalName },
        create: { canonicalName: skill.canonicalName, category: skill.category },
        update: { category: skill.category },
      });
      for (const { alias, textScan } of skill.aliases) {
        await db.skillAlias.upsert({
          where: { alias },
          create: { alias, textScan, skillId: id },
          update: { textScan, skillId: id },
        });
        aliasCount++;
      }
    }
    console.log(`Seeded ${skills.length} skills and ${aliasCount} aliases.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
