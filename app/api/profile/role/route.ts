import { createClient } from "@supabase/supabase-js";
import { isUserRole, roleSwitcherName } from "@/lib/roles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// De rol staat in public.users en mag niet vanuit de browser aangepast worden, dus dit loopt via de service role key.
export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error("Ontbrekende Supabase env vars voor rol wijzigen.");
    return fail("Server is niet correct geconfigureerd.", 500);
  }

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) return fail("Niet ingelogd.", 401);

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await anonClient.auth.getUser(accessToken);
  if (authError || !authData.user) return fail("Sessie is ongeldig. Log opnieuw in.", 401);
  const userId = authData.user.id;

  let body: { role?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Ongeldige aanvraag.", 400);
  }

  const role = body.role;
  if (!isUserRole(role)) return fail("Kies een geldige rol.", 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: caller, error: callerError } = await adminClient
    .from("users").select("name, role").eq("id", userId).maybeSingle();
  if (callerError || !caller) {
    console.error("Fout bij ophalen profiel:", callerError);
    return fail("Kon je profiel niet ophalen.", 500);
  }
  if (caller.name !== roleSwitcherName) return fail("Je mag je rol niet aanpassen.", 403);
  if (caller.role === role) return Response.json({ role });

  const { error: updateError } = await adminClient.from("users").update({ role }).eq("id", userId);
  if (updateError) {
    console.error("Fout bij opslaan rol:", updateError);
    return fail("Rol opslaan is mislukt.", 500);
  }

  return Response.json({ role });
}
