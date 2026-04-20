import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const USERS_TABLE = process.env.USERS_TABLE ?? "users";
const TRANSACTIONS_TABLE = process.env.TRANSACTIONS_TABLE ?? "transactions";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "scripts/output";
const ASSUME_FK_ON_UPDATE_CASCADE =
  (process.env.ASSUME_FK_ON_UPDATE_CASCADE ?? "true").toLowerCase() !==
  "false";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing required env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }

  return all;
}

async function fetchSourceUsers() {
  const { data, error } = await admin
    .from(USERS_TABLE)
    .select("id,username,name,role");
  if (error) throw error;
  return data ?? [];
}

function toMapById(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row?.id) map.set(String(row.id), row);
  }
  return map;
}

function formatError(error) {
  if (!error) return "unknown_error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const shaped = {
      message: error.message ?? null,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    };
    return JSON.stringify(shaped);
  }
  return String(error);
}

async function run() {
  console.log("Starting UUID sync...");
  console.log(`Table: public.${USERS_TABLE}`);
  console.log(`Transactions table: public.${TRANSACTIONS_TABLE}`);
  console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);
  console.log(
    `Assume FK ON UPDATE CASCADE: ${
      ASSUME_FK_ON_UPDATE_CASCADE ? "yes" : "no"
    }`
  );

  const sourceUsers = await fetchSourceUsers();
  const sourceById = toMapById(sourceUsers);
  const authUsers = await listAllAuthUsers();

  const mapLegacyToAuth = new Map();
  for (const authUser of authUsers) {
    const legacyId = authUser?.user_metadata?.legacy_user_id;
    if (!legacyId) continue;
    mapLegacyToAuth.set(String(legacyId), String(authUser.id));
  }

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    usersTable: USERS_TABLE,
    transactionsTable: TRANSACTIONS_TABLE,
    sourceUsers: sourceUsers.length,
    authUsers: authUsers.length,
    plannedUpdates: [],
    skipped: [],
    applied: [],
    failed: [],
  };

  for (const [legacyId, authId] of mapLegacyToAuth.entries()) {
    const source = sourceById.get(legacyId);
    if (!source) {
      report.skipped.push({
        legacyId,
        authId,
        reason: "legacy_user_not_found_in_users_table",
      });
      continue;
    }

    if (legacyId === authId) {
      report.skipped.push({
        legacyId,
        authId,
        username: source.username ?? null,
        reason: "already_synced",
      });
      continue;
    }

    const conflict = sourceById.get(authId);
    if (conflict) {
      report.skipped.push({
        legacyId,
        authId,
        username: source.username ?? null,
        reason: "target_auth_id_already_exists_in_users_table",
      });
      continue;
    }

    report.plannedUpdates.push({
      legacyId,
      authId,
      username: source.username ?? null,
      name: source.name ?? null,
      role: source.role ?? null,
    });
  }

  if (!DRY_RUN) {
    for (const item of report.plannedUpdates) {
      try {
        if (!ASSUME_FK_ON_UPDATE_CASCADE) {
          const { error: txError } = await admin
            .from(TRANSACTIONS_TABLE)
            .update({ user_id: item.authId })
            .eq("user_id", item.legacyId);

          if (txError) {
            throw {
              stage: "transactions_update",
              ...txError,
            };
          }
        }

        const { error: userError } = await admin
          .from(USERS_TABLE)
          .update({ id: item.authId })
          .eq("id", item.legacyId);

        if (userError) {
          throw {
            stage: "users_update",
            ...userError,
          };
        }

        report.applied.push(item);
      } catch (error) {
        report.failed.push({
          ...item,
          error: formatError(error),
        });
      }
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `auth-uuid-sync-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Done.");
  console.log(`Planned updates: ${report.plannedUpdates.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Applied: ${report.applied.length}`);
  console.log(`Failed: ${report.failed.length}`);
  console.log(`Report: ${outputPath}`);

  if (report.failed.length > 0) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error("UUID sync failed:", error);
  process.exit(1);
});
