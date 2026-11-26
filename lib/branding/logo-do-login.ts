import { createAdminClient } from "@/lib/supabase/admin";
import { logoDaCamada } from "./logo";

/**
 * O logo exclusivo da página de login (migration 9110), já como URL pública.
 *
 * Leitura SEPARADA da linha da marca de propósito: a coluna é nova, e incluí-la
 * no `select` de `marcaDaInstalacao` faria uma instalação sem a 9110 aplicada
 * perder a marca inteira (o PostgREST recusa a linha toda com 42703). Aqui, sem a
 * coluna ou com qualquer erro, devolve `null` e o login usa o logo da marca.
 */
export async function logoDoLogin(): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("platform_branding")
      .select("login_logo_path")
      .eq("id", 1)
      .maybeSingle();
    if (error) return null;
    return logoDaCamada(data?.login_logo_path ?? null, null);
  } catch {
    return null;
  }
}
