"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";

import type { ConfigOf } from "./shared";
import { SeletorDeCampoDoContato } from "./SeletorDeCampoDoContato";

/**
 * Nó `set_contact_field` — grava num campo do contato um texto fixo ou a última
 * resposta do lead. Não manda mensagem.
 */
export function SetContactFieldForm({
  config,
  onChange,
}: {
  config: ConfigOf<"set_contact_field">;
  onChange: (c: ConfigOf<"set_contact_field">) => void;
}) {
  const t = useT();
  const fonte = config.fonte ?? "fixo";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="scf-alvo">{t("Campo do contato")}</Label>
        <SeletorDeCampoDoContato
          id="scf-alvo"
          valor={config.alvo}
          soGravaveis
          onEscolher={(alvo) => onChange({ ...config, alvo })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scf-fonte">{t("Gravar")}</Label>
        <Select
          value={fonte}
          onValueChange={(v) => onChange({ ...config, fonte: v as "fixo" | "ultima_resposta" })}
        >
          <SelectTrigger id="scf-fonte">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixo">{t("Um valor que eu escrevo")}</SelectItem>
            <SelectItem value="ultima_resposta">{t("A última resposta do lead")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {fonte === "fixo" && (
        <div className="space-y-2">
          <Label htmlFor="scf-valor">{t("Valor")}</Label>
          <Input
            id="scf-valor"
            value={config.valor ?? ""}
            maxLength={500}
            placeholder={t("ex.: Box para banheiro")}
            onChange={(e) => onChange({ ...config, valor: e.target.value })}
          />
          <p className="text-xs text-text-muted">
            {t("Aceita {nome} e {primeiro_nome}.")}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="scf-existe">{t("Se o campo já tiver valor")}</Label>
        <Select
          value={config.se_ja_tiver ?? "sobrescrever"}
          onValueChange={(v) => onChange({ ...config, se_ja_tiver: v as "sobrescrever" | "manter" })}
        >
          <SelectTrigger id="scf-existe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sobrescrever">{t("Substituir pelo novo")}</SelectItem>
            <SelectItem value="manter">{t("Manter o que já tem")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-text-muted">{t("Esta caixa não envia mensagem: só grava e segue.")}</p>
    </div>
  );
}
