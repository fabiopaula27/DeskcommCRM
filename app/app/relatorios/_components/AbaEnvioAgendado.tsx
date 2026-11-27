"use client";

/**
 * Envio agendado: o relatório em PDF sai sozinho por e-mail e WhatsApp.
 * Diário cobre ontem; semanal (toda segunda) a semana anterior; mensal (todo
 * dia 1) o mês anterior. Só dono/admin configura — a rota recusa os demais.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { AvisoDaAba, Bloco, Carregando } from "./blocos/Blocos";

type Canal = { id: string; nome: string; telefone: string | null; conectado: boolean };
type Agendamento = {
  ativo: boolean;
  frequencia: "diario" | "semanal" | "mensal";
  horario: string;
  emails: string[];
  telefones: string[];
  channel_session_id: string | null;
  ultimo_envio_em: string | null;
  ultimo_erro: string | null;
  ultimo_periodo: string | null;
};
type Resposta =
  | { disponivel: false; motivo: string }
  | { disponivel: true; agendamento: Agendamento | null; canais: Canal[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONE = /^\+[1-9]\d{7,14}$/;

const QUANDO: Record<Agendamento["frequencia"], string> = {
  diario: "Todo dia, com os números de ontem.",
  semanal: "Toda segunda-feira, com a semana anterior (segunda a domingo).",
  mensal: "Todo dia 1, com o mês anterior inteiro.",
};

export function AbaEnvioAgendado() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["relatorios", "agendamento"],
    queryFn: () => apiClient.get<{ data: Resposta }>("/api/v1/reports/schedule"),
  });

  const [ativo, setAtivo] = useState(true);
  const [frequencia, setFrequencia] = useState<Agendamento["frequencia"]>("diario");
  const [horario, setHorario] = useState("08:00");
  const [emails, setEmails] = useState<string[]>([""]);
  const [telefones, setTelefones] = useState<string[]>([]);
  const [canal, setCanal] = useState<string>("");
  const [carregado, setCarregado] = useState(false);

  const dados = q.data?.data;
  useEffect(() => {
    if (carregado || !dados || !dados.disponivel) return;
    const a = dados.agendamento;
    if (a) {
      setAtivo(a.ativo);
      setFrequencia(a.frequencia);
      setHorario(a.horario.slice(0, 5));
      setEmails(a.emails.length > 0 ? a.emails : [""]);
      setTelefones(a.telefones);
      setCanal(a.channel_session_id ?? "");
    }
    if (!a?.channel_session_id) {
      const primeiro = dados.canais.find((c) => c.conectado) ?? dados.canais[0];
      if (primeiro) setCanal(primeiro.id);
    }
    setCarregado(true);
  }, [dados, carregado]);

  const salvar = useMutation({
    mutationFn: (corpo: unknown) => apiClient.put("/api/v1/reports/schedule", corpo),
    onSuccess: () => {
      toast.success(t("Agendamento salvo."));
      void qc.invalidateQueries({ queryKey: ["relatorios", "agendamento"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("Não consegui salvar agora.")),
  });

  if (q.isLoading) return <Carregando />;
  if (q.isError || !dados) {
    return <AvisoDaAba texto={t("Só o dono ou um administrador da empresa configura o envio agendado.")} />;
  }
  if (!dados.disponivel) return <AvisoDaAba texto={dados.motivo} />;

  const emailsLimpos = emails.map((e) => e.trim()).filter(Boolean);
  const telefonesLimpos = telefones.map((x) => x.replace(/[\s()-]/g, "")).filter(Boolean);
  const emailsOk = emailsLimpos.every((e) => EMAIL.test(e));
  const telefonesOk = telefonesLimpos.every((x) => TELEFONE.test(x));
  const canalOk = telefonesLimpos.length === 0 || !!canal;
  const podeSalvar = emailsOk && telefonesOk && canalOk && !salvar.isPending;
  const a = dados.agendamento;

  return (
    <Bloco
      titulo={t("Envio agendado de relatórios")}
      descricao={t("O relatório em PDF chega sozinho por e-mail e WhatsApp, no horário da empresa.")}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!podeSalvar) return;
          salvar.mutate({
            ativo,
            frequencia,
            horario,
            emails: emailsLimpos,
            telefones: telefonesLimpos,
            channel_session_id: telefonesLimpos.length > 0 ? canal : null,
          });
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          {t("Envio ligado")}
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("Frequência")}
            <select
              value={frequencia}
              onChange={(e) => setFrequencia(e.target.value as Agendamento["frequencia"])}
              className="h-10 rounded-md border border-border bg-surface px-2"
            >
              <option value="diario">{t("Diário")}</option>
              <option value="semanal">{t("Semanal")}</option>
              <option value="mensal">{t("Mensal")}</option>
            </select>
            <span className="text-xs text-text-muted">{t(QUANDO[frequencia])}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("Horário")}
            <Input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
            <span className="text-xs text-text-muted">{t("No fuso da empresa. Pode chegar até 15 minutos depois.")}</span>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">{t("E-mails")}</legend>
            <p className="mb-3 text-xs text-text-muted">{t("Recebem o PDF em anexo.")}</p>
            <div className="flex flex-col gap-2">
              {emails.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`${t("E-mail")} ${i + 1}`}
                    type="email"
                    value={v}
                    placeholder="gestor@empresa.com"
                    onChange={(e) => setEmails((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                  />
                  <Button type="button" variant="outline" onClick={() => setEmails((x) => x.filter((_, j) => j !== i))}>
                    {t("Remover")}
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" className="self-start" disabled={emails.length >= 20} onClick={() => setEmails((x) => [...x, ""])}>
                + {t("Adicionar e-mail")}
              </Button>
            </div>
          </fieldset>

          <fieldset className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">{t("Telefones")}</legend>
            <p className="mb-3 text-xs text-text-muted">{t("Com código do país, por exemplo +5516999999999. Recebem o PDF como documento.")}</p>
            <div className="flex flex-col gap-2">
              {telefones.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`${t("Telefone")} ${i + 1}`}
                    value={v}
                    placeholder="+5516999999999"
                    onChange={(e) => setTelefones((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                  />
                  <Button type="button" variant="outline" onClick={() => setTelefones((x) => x.filter((_, j) => j !== i))}>
                    {t("Remover")}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={telefones.length >= 20}
                onClick={() => setTelefones((x) => [...x, ""])}
              >
                + {t("Adicionar telefone")}
              </Button>
              <label className="mt-2 flex flex-col gap-1 text-sm">
                {t("Número que envia")}
                <select value={canal} onChange={(e) => setCanal(e.target.value)} className="h-10 rounded-md border border-border bg-surface px-2">
                  <option value="">{t("Escolha um número")}</option>
                  {dados.canais.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.telefone && c.nome !== c.telefone ? ` — ${c.telefone}` : ""}
                      {c.conectado ? "" : ` (${t("desconectado")})`}
                    </option>
                  ))}
                </select>
                {dados.canais.length === 0 ? (
                  <span className="text-xs text-warning-fg">{t("Conecte um número por QR Code em Conexões para enviar pelo WhatsApp.")}</span>
                ) : null}
              </label>
            </div>
          </fieldset>
        </div>

        {!emailsOk ? <p className="text-sm text-error-fg">{t("Confira os e-mails: algum está em formato inválido.")}</p> : null}
        {!telefonesOk ? <p className="text-sm text-error-fg">{t("Confira os telefones: use o formato +5516999999999.")}</p> : null}
        {!canalOk ? <p className="text-sm text-error-fg">{t("Escolha o número de WhatsApp que vai enviar.")}</p> : null}

        {a?.ultimo_envio_em || a?.ultimo_erro ? (
          <div className="rounded-md border border-border bg-bg p-3 text-sm">
            {a.ultimo_envio_em ? (
              <p>
                {t("Último envio:")} {new Date(a.ultimo_envio_em).toLocaleString("pt-BR")}
              </p>
            ) : null}
            {a.ultimo_erro ? (
              <p className="text-error-fg">
                {t("Problema no último envio:")} {a.ultimo_erro}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={!podeSalvar}>
            {salvar.isPending ? t("Salvando…") : t("Salvar agendamento")}
          </Button>
        </div>
      </form>
    </Bloco>
  );
}
