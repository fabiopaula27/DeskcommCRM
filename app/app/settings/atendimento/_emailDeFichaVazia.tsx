"use client";

/**
 * O interruptor do e-mail de ficha vazia — irmão do interruptor do telefone.
 * Salva no clique; o texto diz o que NÃO acontece (não troca e-mail existente).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { definirEmailDeFichaVazia } from "@/app/actions/settings/definirEmailDeFichaVazia";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const ERRO: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta opção.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
};

export function EmailDeFichaVazia({
  ligada,
  idioma,
  podeMudar,
}: {
  ligada: boolean;
  idioma: Idioma;
  /** Espelha o `admin` que a action cobra. Cortesia, não autorização. */
  podeMudar: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [valor, setValor] = useState(ligada);
  const [isPending, startTransition] = useTransition();

  function mudar(novo: boolean) {
    setValor(novo);
    startTransition(async () => {
      const r = await definirEmailDeFichaVazia(novo);
      if (r.ok) {
        setValor(r.ligado);
        toast.success(t("Opção salva."));
        router.refresh();
        return;
      }
      setValor(!novo);
      toast.error(t(ERRO[r.error] ?? "Não consegui salvar agora."));
    });
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="email_de_ficha_vazia">
            {t("E-mail informado pelo cliente entra sozinho na ficha sem e-mail")}
          </Label>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t(
              "Quando o cliente diz o e-mail numa conversa e a ficha do contato está SEM e-mail, ele é gravado na hora, sem esperar alguém confirmar — assim o convite do Google Agenda já sai para ele quando a reunião é marcada. Aparece na linha do tempo do contato quando ele tem um negócio aberto. Nunca troca o e-mail de quem já tem um, e um e-mail que já é de outro contato continua virando proposta. Vem desligada.",
            )}
          </p>
          <p className="max-w-2xl text-xs" data-testid="email-de-ficha-vazia-estado">
            {valor
              ? t("Ligado: o e-mail de um cadastro sem e-mail entra sozinho, e fica registrado na linha do tempo quando o contato tem um negócio aberto.")
              : t("Desligado: todo e-mail informado vira proposta, como o resto do dado ouvido na conversa.")}
          </p>
          {!podeMudar && (
            <p className="text-xs text-muted-foreground">
              {t("Só um administrador da organização pode mudar esta opção.")}
            </p>
          )}
        </div>
        <Switch
          id="email_de_ficha_vazia"
          checked={valor}
          disabled={isPending || !podeMudar}
          onCheckedChange={mudar}
        />
      </div>
    </Card>
  );
}
