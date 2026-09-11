import type { Db } from "@/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Role changes and password recovery share a lock so grants cannot acquire new powers. */
export async function lockRoleManagement(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(20260911, 7)`);
}
