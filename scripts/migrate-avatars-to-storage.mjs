import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function loadEnvFile(filename) {
  const filePath = path.join(projectRoot, filename);
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const avatarBucket = process.env.NEXT_PUBLIC_SUPABASE_AVATAR_BUCKET ?? "avatars";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function isDataUrlAvatar(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Unsupported avatar data URL.");
  }

  const [, contentType, base64] = match;
  const extension = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "img";

  return {
    contentType,
    extension,
    buffer: Buffer.from(base64, "base64"),
  };
}

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(avatarBucket, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/*"],
  });

  if (error && !error.message.toLowerCase().includes("already exists")) {
    throw error;
  }
}

async function main() {
  await ensureBucket();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, avatar");

  if (error) {
    throw error;
  }

  const usersToMigrate = (users ?? []).filter((user) => isDataUrlAvatar(user.avatar));

  if (usersToMigrate.length === 0) {
    console.log("Geen base64 avatars gevonden om te migreren.");
    return;
  }

  console.log(`Bezig met migreren van ${usersToMigrate.length} avatar(s) naar bucket "${avatarBucket}"...`);

  for (const user of usersToMigrate) {
    const { buffer, contentType, extension } = parseDataUrl(user.avatar);
    const path = `users/${user.id}/avatar-migrated-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(avatarBucket)
      .upload(path, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error(`Upload mislukt voor ${user.name ?? user.id}:`, uploadError.message);
      continue;
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar: path })
      .eq("id", user.id);

    if (updateError) {
      console.error(`Database update mislukt voor ${user.name ?? user.id}:`, updateError.message);
      await supabase.storage.from(avatarBucket).remove([path]);
      continue;
    }

    console.log(`Gemigreerd: ${user.name ?? user.id}`);
  }

  console.log("Migratie klaar.");
}

main().catch((error) => {
  console.error("Migratie mislukt:", error);
  process.exitCode = 1;
});
