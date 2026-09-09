import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const authEmailDomain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "saldo.local";
const maxUsernameLength = 12;

function sanitizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 48);
}

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Iedereen mag zijn eigen gebruikersnaam kiezen. Omdat je inlogt met <gebruikersnaam>@domein
// moet het auth e-mailadres mee veranderen, en dat kan alleen met de service role key.
export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error("Ontbrekende Supabase env vars voor gebruikersnaam wijzigen.");
    return fail("Server is niet correct geconfigureerd.", 500);
  }

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) return fail("Niet ingelogd.", 401);

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await anonClient.auth.getUser(accessToken);
  if (authError || !authData.user) return fail("Sessie is ongeldig. Log opnieuw in.", 401);
  const userId = authData.user.id;

  let body: { username?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Ongeldige aanvraag.", 400);
  }

  const rawUsername = String(body.username ?? "").trim();
  if (rawUsername.length > maxUsernameLength) return fail(`Een gebruikersnaam is maximaal ${maxUsernameLength} tekens.`, 400);
  const username = sanitizeUsername(rawUsername);
  if (username.length < 2) return fail("Vul een geldige gebruikersnaam in van minimaal 2 tekens.", 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: current, error: currentError } = await adminClient
    .from("users").select("username").eq("id", userId).maybeSingle();
  if (currentError || !current) {
    console.error("Fout bij ophalen profiel:", currentError);
    return fail("Kon je profiel niet ophalen.", 500);
  }
  if (current.username === username) return Response.json({ username });

  const { data: existing, error: existingError } = await adminClient
    .from("users").select("id").eq("username", username).neq("id", userId).maybeSingle();
  if (existingError) {
    console.error("Fout bij controleren gebruikersnaam:", existingError);
    return fail("Kon gebruikersnaam niet controleren.", 500);
  }
  if (existing) return fail(`Gebruikersnaam "${username}" is al bezet.`, 409);

  const previousEmail = authData.user.email;
  const email = `${username}@${authEmailDomain}`;
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
    user_metadata: { ...authData.user.user_metadata, username },
  });
  if (authUpdateError) {
    console.error("Fout bij bijwerken auth e-mail:", authUpdateError);
    const alreadyExists = authUpdateError.message?.toLowerCase().includes("already");
    return fail(alreadyExists ? `Gebruikersnaam "${username}" is al bezet.` : "Gebruikersnaam wijzigen is mislukt.", alreadyExists ? 409 : 500);
  }

  const { error: updateError } = await adminClient.from("users").update({ username }).eq("id", userId);
  if (updateError) {
    // Inloggen moet blijven werken met de oude naam: het e-mailadres terugzetten.
    if (previousEmail) {
      const { error: revertError } = await adminClient.auth.admin.updateUserById(userId, { email: previousEmail, email_confirm: true });
      if (revertError) console.error("Terugzetten van auth e-mail mislukt:", revertError);
    }
    console.error("Fout bij opslaan gebruikersnaam:", updateError);
    return fail("Gebruikersnaam opslaan is mislukt.", 500);
  }

  return Response.json({ username });
}
