import { and, eq } from "drizzle-orm";
import { getDb, withTenant, type Db } from "@/db";
import { auditLog, business, program } from "@/db/schema";
import type { ProgramInput } from "@/lib/program-rules";

export { programSchema, PROGRAM_DEFAULTS, type ProgramInput } from "@/lib/program-rules";

/** The business's active card program, or null before the owner designs one. */
export async function getActiveProgram(businessId: string, db: Db = getDb()) {
  return withTenant(
    { businessId },
    async (tx) => {
      const [row] = await tx
        .select()
        .from(program)
        .where(and(eq(program.businessId, businessId), eq(program.active, true)))
        .limit(1);
      return row ?? null;
    },
    db,
  );
}

/**
 * Creates or updates the business's one active card (v1 allows one) and its
 * brand colour, recording who changed what. Callers must have checked that
 * `userId` is an owner of `businessId`.
 */
export async function saveProgram(
  businessId: string,
  userId: string,
  input: ProgramInput,
  db: Db = getDb(),
): Promise<{ programId: string; created: boolean }> {
  const { brandColor, ...rules } = input;
  return withTenant(
    { businessId },
    async (tx) => {
      await tx.update(business).set({ brandColor }).where(eq(business.id, businessId));

      const [existing] = await tx
        .select({ id: program.id })
        .from(program)
        .where(and(eq(program.businessId, businessId), eq(program.active, true)))
        .limit(1);

      let programId: string;
      if (existing) {
        await tx.update(program).set(rules).where(eq(program.id, existing.id));
        programId = existing.id;
      } else {
        [{ id: programId }] = await tx.insert(program).values({ businessId, ...rules }).returning({ id: program.id });
      }

      await tx.insert(auditLog).values({
        businessId,
        actorUserId: userId,
        action: existing ? "program.updated" : "program.created",
        target: `program:${programId}`,
        metadata: input,
      });
      return { programId, created: !existing };
    },
    db,
  );
}
