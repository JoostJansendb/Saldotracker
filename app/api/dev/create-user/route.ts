import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const authEmailDomain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "saldo.local";

function sanitizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 48);
}

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error("Ontbrekende Supabase env vars voor gebruiker aanmaken.");
    return fail("Server is niet correct geconfigureerd.", 500);
  }

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) return fail("Niet ingelogd.", 401);

  // De aanroeper valideren met zijn eigen token, niet met de service role key.
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await anonClient.auth.getUser(accessToken);
  if (authError || !authData.user) return fail("Sessie is ongeldig. Log opnieuw in.", 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: caller, error: callerError } = await adminClient
    .from("users").select("role").eq("id", authData.user.id).maybeSingle();
  if (callerError) {
    console.error("Fout bij ophalen aanroeper:", callerError);
    return fail("Kon je account niet verifiëren.", 500);
  }
  if (caller?.role !== "dev") return fail("Alleen een dev kan gebruikers toevoegen.", 403);

  let body: { username?: unknown; name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Ongeldige aanvraag.", 400);
  }

  const username = sanitizeUsername(String(body.username ?? ""));
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");

  if (!username) return fail("Vul een geldige gebruikersnaam in.", 400);
  if (!name) return fail("Vul de volledige naam in.", 400);
  if (password.length < 8) return fail("Wachtwoord moet minimaal 8 tekens zijn.", 400);

  const { data: existing, error: existingError } = await adminClient
    .from("users").select("id").eq("username", username).maybeSingle();
  if (existingError) {
    console.error("Fout bij controleren gebruikersnaam:", existingError);
    return fail("Kon gebruikersnaam niet controleren.", 500);
  }
  if (existing) return fail(`Gebruikersnaam "${username}" bestaat al.`, 409);

  const email = `${username}@${authEmailDomain}`;
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, name },
  });
  if (createError || !created.user) {
    console.error("Fout bij aanmaken auth gebruiker:", createError);
    const alreadyExists = createError?.message?.toLowerCase().includes("already");
    return fail(alreadyExists ? `Er bestaat al een account voor ${email}.` : "Aanmaken van het account is mislukt.", alreadyExists ? 409 : 500);
  }

  const { error: insertError } = await adminClient.from("users").insert({
    id: created.user.id,
    username,
    name,
    role: "user",
    balance: 0,
    avatar: "",
  });

  if (insertError) {
    // Geen half aangemaakte gebruiker achterlaten: auth account weer weghalen.
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
    if (cleanupError) console.error("Opruimen van auth gebruiker mislukt:", cleanupError);
    console.error("Fout bij aanmaken profiel:", insertError);
    return fail("Aanmaken van het profiel is mislukt.", 500);
  }

  return Response.json({ user: { id: created.user.id, username, name, email } }, { status: 201 });
}
