"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  disconnectAdInsights,
  updateAdInsightsConnection,
} from "@/app/actions/settings/updateAdInsightsConnection";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * Cada recusa vira uma frase que diz O QUE FAZER — mesma regra do formulário de
 * Conversões. `cifra_indisponivel` é a que mais importa acertar: é problema de
 * INSTALAÇÃO, e um texto genérico mandaria o admin do tenant refazer um cadastro
 * que já está certo, para falhar igual.
 */
const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  cifra_indisponivel:
    "Esta instalação está sem a chave mestra de criptografia, e o token não foi gravado. Quem instalou o sistema precisa configurá-la — refazer o cadastro aqui não resolve.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

export function FormularioDeMetaAds({
  conectada,
  contasPermitidas,
  idioma,
}: {
  conectada: boolean;
  contasPermitidas: string[];
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [token, setToken] = useState("");
  const [conta, setConta] = useState(contasPermitidas[0] ?? "");
  const [extras, setExtras] = useState<string[]>(contasPermitidas.slice(1));
  const FORMATO = /^act_\d+$/;
  const contaValida = FORMATO.test(conta.trim());
  const extrasValidas = extras.every((e) => e.trim() === "" || FORMATO.test(e.trim()));

  // Na primeira conexão o token é obrigatório — a coluna é NOT NULL (0214) e a
  // Server Action recusa. Barrar aqui explica antes de o clique acontecer, em
  // vez de devolver um erro de validação depois.
  const podeSalvar = (conectada || token.trim().length >= 20) && contaValida && extrasValidas;

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    startTransition(async () => {
      const resultado = await updateAdInsightsConnection({
        platform: "meta_ads",
        access_token: token.trim() || undefined,
        contas: [conta.trim(), ...extras.map((e) => e.trim()).filter(Boolean)],
      });

      if (resultado.ok) {
        // O campo é limpo no sucesso: deixá-lo preenchido dá a impressão de que
        // a tela guarda o token, e ela nunca o mostra de volta.
        setToken("");
        toast.success(t("Conexão salva."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui salvar agora."));
    });
  }

  function desconectar() {
    startTransition(async () => {
      const resultado = await disconnectAdInsights();
      if (resultado.ok) {
        setToken("");
        setConta("");
        setExtras([]);
        toast.success(t("Conta desconectada."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui desconectar agora."));
    });
  }

  return (
    <Card className="p-6">
      <form onSubmit={salvar} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="access_token">{t("Token de acesso")}</Label>
          <Input
            id="access_token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={conectada ? t("Guardado — preencha só para trocar") : "EAA…"}
          />
          <p className="text-xs text-muted-foreground">
            {conectada
              ? t(
                  "Já existe um token guardado. Deixe em branco para mantê-lo, ou cole um novo para substituir.",
                )
              : t("Precisa da permissão ads_read.")}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="default_account_id">{t("Conta padrão")}</Label>
          <Input
            id="default_account_id"
            required
            value={conta}
            onChange={(e) => setConta(e.target.value)}
            placeholder="act_123456789012345"
          />
          <p className="text-xs text-muted-foreground">
            {t(
              "Obrigatória. A tela de Meta Ads mostra só as contas informadas aqui, mesmo que o token alcance outras.",
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("Outras contas de anúncio")}</Label>
          {extras.map((valor, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`${t("Conta adicional")} ${i + 1}`}
                value={valor}
                onChange={(e) =>
                  setExtras((atual) => atual.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder="act_123456789012345"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setExtras((atual) => atual.filter((_, j) => j !== i))}
              >
                {t("Remover")}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setExtras((atual) => [...atual, ""])}
            >
              + {t("Adicionar conta de anúncio")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Usam o mesmo token. Formato act_ seguido dos números da conta.")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending || !podeSalvar}>
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>

          {conectada && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={desconectar}
            >
              {t("Desconectar")}
            </Button>
          )}

          {!podeSalvar && (
            <span className="text-sm text-muted-foreground">
              {!contaValida
                ? t("Informe a conta padrão no formato act_123456789.")
                : !extrasValidas
                  ? t("Confira as outras contas: use o formato act_123456789.")
                  : t("Cole o token para poder salvar.")}
            </span>
          )}
        </div>

        {conectada && (
          <p className="text-xs text-muted-foreground">
            {/*
              Desconectar APAGA a linha — não existe "pausar" nesta feature, e o
              porquê está no cabeçalho da 0214: como nada roda sozinho, um estado
              "conectado mas desligado" teria a mesma consequência visível de não
              estar conectado.
            */}
            {t(
              "Desconectar apaga o token guardado. A tela de Meta Ads volta a pedir uma conexão, e nenhum dado histórico é perdido — nada é armazenado aqui.",
            )}
          </p>
        )}
      </form>
    </Card>
  );
}
