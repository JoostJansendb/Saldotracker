import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN ?? "saldo.local";
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const USERS_TABLE = process.env.USERS_TABLE ?? "users";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "scripts/output";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing required env vars: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sanitizeUsername(username) {
  return String(username ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48);
}

function uniqueEmailFromUsername(username, domain, usedEmails, fallbackSeed) {
  const safeName = sanitizeUsername(username) || `user.${fallbackSeed}`;
  let candidate = `${safeName}@${domain}`;

  if (!usedEmails.has(candidate)) {
    usedEmails.add(candidate);
    return candidate;
  }

  let i = 2;
  while (usedEmails.has(`${safeName}.${i}@${domain}`)) i += 1;
  candidate = `${safeName}.${i}@${domain}`;
  usedEmails.add(candidate);
  return candidate;
}

async function listAllAuthUsersByEmail() {
  const byEmail = new Map();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return byEmail;
}

async function fetchSourceUsers() {
  const { data, error } = await admin.from(USERS_TABLE).select("*");
  if (error) throw error;
  return data ?? [];
}

async function run() {
  console.log("Starting auth import...");
  console.log(`Table: public.${USERS_TABLE}`);
  console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);
  console.log(`Email domain: ${AUTH_EMAIL_DOMAIN}`);

  const sourceUsers = await fetchSourceUsers();
  const authUsersByEmail = await listAllAuthUsersByEmail();
  const usedEmails = new Set(authUsersByEmail.keys());

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    totalSourceUsers: sourceUsers.length,
    created: [],
    skipped: [],
    failed: [],
  };

  for (const source of sourceUsers) {
    const sourceId = String(source.id ?? "");
    const username = String(source.username ?? "").trim();
    const password = String(source.password ?? "");

    if (!username) {
      report.skipped.push({
        sourceId,
        reason: "missing_username",
      });
      continue;
    }

    if (!password) {
      report.skipped.push({
        sourceId,
        username,
        reason: "missing_password",
      });
      continue;
    }

    const email = uniqueEmailFromUsername(
      username,
      AUTH_EMAIL_DOMAIN,
      usedEmails,
      sourceId || `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    );

    if (authUsersByEmail.has(email.toLowerCase())) {
      report.skipped.push({
        sourceId,
        username,
        email,
        reason: "already_exists",
      });
      continue;
    }

    const payload = {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        legacy_user_id: source.id ?? null,
        name: source.name ?? null,
      },
    };

    if (DRY_RUN) {
      report.created.push({
        sourceId,
        username,
        email,
        authUserId: null,
        dryRun: true,
      });
      continue;
    }

    const { data, error } = await admin.auth.admin.createUser(payload);
    if (error) {
      report.failed.push({
        sourceId,
        username,
        email,
        error: error.message,
      });
      continue;
    }

    report.created.push({
      sourceId,
      username,
      email,
      authUserId: data.user?.id ?? null,
      dryRun: false,
    });
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `auth-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Done.");
  console.log(`Source users: ${report.totalSourceUsers}`);
  console.log(`Created: ${report.created.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Failed: ${report.failed.length}`);
  console.log(`Report: ${outputPath}`);

  if (report.failed.length > 0) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
