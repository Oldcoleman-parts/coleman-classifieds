// The EmailSettings singleton (row id 1). Created on first read; staff edit it in F03-T3.
import prisma from "@/db.server";

/**
 * @returns {Promise<import("@prisma/client").EmailSettings>}
 */
export async function getEmailSettings() {
  const existing = await prisma.emailSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  // The two columns without a database default start from the environment.
  await prisma.emailSettings.createMany({
    data: [
      {
        id: 1,
        fromAddress: process.env.SES_FROM_TRANSACTIONAL ?? "",
        postalAddress: process.env.OCP_POSTAL_ADDRESS ?? "",
        staffNotify: [],
      },
    ],
    skipDuplicates: true,
  });
  return prisma.emailSettings.findUniqueOrThrow({ where: { id: 1 } });
}
