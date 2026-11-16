"use client";

import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { usePipelines } from "@/hooks/webhooks/useWebhookSources";
import { CAMPOS_FIXOS_DO_CONTATO } from "@/lib/followup/campo-do-contato";
import { camposDoFunil, camposPorEscopo } from "@/lib/leads/campos-do-funil";

/** Os campos personalizados de CONTATO declarados em qualquer funil da organização. */
export function useCamposPersonalizadosDoContato(): { campos: { key: string; label: string }[]; carregando: boolean } {
  const q = usePipelines();
  const campos = useMemo(() => {
    const vistos = new Map<string, { key: string; label: string }>();
    const lista = (q.data?.data ?? []) as { settings?: Record<string, unknown> | null; is_archived?: boolean }[];
    for (const p of lista) {
      if (p.is_archived) continue;
      for (const c of camposPorEscopo(camposDoFunil(p.settings ?? null), "contato"))
        if (!vistos.has(c.key)) vistos.set(c.key, { key: c.key, label: c.label });
    }
    return [...vistos.values()];
  }, [q.data]);
  return { campos, carregando: q.isLoading };
}

/**
 * Seletor do campo do contato: gerais (Nome, E-mail…) e personalizados (`cf:<chave>`).
 * `soGravaveis` esconde o que o fluxo não pode escrever (telefone).
 */
export function SeletorDeCampoDoContato({
  valor,
  onEscolher,
  soGravaveis = false,
  id,
}: {
  valor: string;
  onEscolher: (alvo: string) => void;
  soGravaveis?: boolean;
  id?: string;
}) {
  const t = useT();
  const { campos, carregando } = useCamposPersonalizadosDoContato();
  const fixos = CAMPOS_FIXOS_DO_CONTATO.filter((c) => !soGravaveis || c.gravavel);
  const conhecido =
    fixos.some((c) => c.alvo === valor) || campos.some((c) => `cf:${c.key}` === valor);

  return (
    <Select value={conhecido ? valor : ""} onValueChange={onEscolher}>
      <SelectTrigger id={id} aria-label={t("Campo do contato")}>
        <SelectValue placeholder={carregando ? t("Carregando campos…") : t("Escolha o campo")} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("Campos do contato")}</SelectLabel>
          {fixos.map((c) => (
            <SelectItem key={c.alvo} value={c.alvo}>
              {t(c.rotulo)}
            </SelectItem>
          ))}
        </SelectGroup>
        {campos.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("Campos personalizados")}</SelectLabel>
            {campos.map((c) => (
              <SelectItem key={c.key} value={`cf:${c.key}`}>
                {c.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
