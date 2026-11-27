"use client";

/**
 * Aba "Anotações" da ficha do contato: o que a equipe sabe do lead (texto ou
 * áudio transcrito), tarefas para depois e o Resumo da IA — numa linha do
 * tempo com data e hora de cada registro.
 */
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";

import { FormularioDeTarefa } from "@/app/app/tasks/_components/FormularioDeTarefa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useAnotacoes, useAudiosDaConversa, useResumoDoLead, type ResumoDoLead } from "@/hooks/contacts/useAnotacoes";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { useT } from "@/hooks/i18n/useT";
import { useTasks } from "@/hooks/tasks/useTasks";
import type { Anotacao } from "@/lib/contatos/anotacoes";
import { linhaDoTempo, mimeDeGravacao } from "@/lib/contatos/linha-do-tempo-das-anotacoes";
import type { NovaTarefa, Tarefa } from "@/lib/tarefas/tipos";
import { ChatCircle, ListChecks, Microphone, Note, PencilSimple, Plus, Sparkle, Trash, UploadSimple, X } from "@/lib/ui/icons";

type Props = {
  contactId: string;
  podeEscrever: boolean;
  /** Chave do campo personalizado "Resumo" do contato; `null` = sem botão de salvar. */
  campoResumo: string | null;
  camposAtuais: Record<string, unknown>;
};

const quando = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm");
const LIMITE_DA_GRAVACAO_S = 600;

export function AbaAnotacoes({ contactId, podeEscrever, campoResumo, camposAtuais }: Props) {
  const t = useT();
  const usuario = useUser();
  const notas = useAnotacoes(contactId);
  const tarefas = useTasks({ contact_id: contactId });
  const [tarefaAberta, setTarefaAberta] = useState(false);
  const [aberturas, setAberturas] = useState(0);
  const [audiosAbertos, setAudiosAbertos] = useState(false);

  const itens = useMemo(
    () => linhaDoTempo(notas.lista.data?.anotacoes ?? [], tarefas.tarefas ?? []),
    [notas.lista.data, tarefas.tarefas],
  );

  if (notas.lista.data && !notas.lista.data.disponivel) {
    return (
      <Card className="p-4 text-sm text-text-muted">
        {t("As anotações ainda não estão ativas nesta instalação.")} {notas.lista.data.motivo}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {podeEscrever && (
        <Card className="space-y-3 p-4">
          <NovaAnotacao notas={notas} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={() => setAudiosAbertos(true)}>
              <ChatCircle className="mr-1.5 h-4 w-4" aria-hidden /> {t("Usar áudio da conversa")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAberturas((n) => n + 1);
                setTarefaAberta(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> {t("Nova tarefa")}
            </Button>
          </div>
        </Card>
      )}

      <ResumoDaIA contactId={contactId} campoResumo={podeEscrever ? campoResumo : null} camposAtuais={camposAtuais} />

      <section aria-label={t("Linha do tempo das anotações")} className="space-y-2">
        {notas.lista.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : itens.length === 0 ? (
          <Card className="p-6 text-center text-sm text-text-muted">
            {t("Nenhuma anotação ainda. Registre o que você sabe deste lead por texto ou áudio.")}
          </Card>
        ) : (
          <ol className="space-y-2">
            {itens.map((item) =>
              item.tipo === "anotacao" ? (
                <li key={`a-${item.anotacao.id}`}>
                  <ItemDeAnotacao anotacao={item.anotacao} notas={notas} />
                </li>
              ) : (
                <li key={`t-${item.tarefa.id}`}>
                  <ItemDeTarefa tarefa={item.tarefa} />
                </li>
              ),
            )}
          </ol>
        )}
      </section>

      <AudiosDaConversa contactId={contactId} aberto={audiosAbertos} aoFechar={() => setAudiosAbertos(false)} notas={notas} />

      <FormularioDeTarefa
        key={aberturas}
        aberto={tarefaAberta}
        aoMudarAbertura={setTarefaAberta}
        tarefa={null}
        aoSalvar={(entrada: NovaTarefa) => tarefas.criarTarefa(entrada)}
        leadId={null}
        contactId={contactId}
        responsavelPadrao={usuario.id}
      />
    </div>
  );
}

type Notas = ReturnType<typeof useAnotacoes>;

function NovaAnotacao({ notas }: { notas: Notas }) {
  const t = useT();
  const [texto, setTexto] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);
  const salvando = notas.criarTexto.isPending || notas.enviarAudio.isPending;

  return (
    <div className="space-y-2">
      <label htmlFor="nova-anotacao" className="flex items-center gap-1.5 text-sm font-medium">
        <Note className="h-4 w-4" aria-hidden /> {t("Nova anotação")}
      </label>
      <Textarea
        id="nova-anotacao"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={5000}
        rows={3}
        placeholder={t("O que você sabe deste lead? Ex.: prefere contato depois das 18h.")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!texto.trim() || salvando}
          onClick={() => notas.criarTexto.mutate(texto.trim(), { onSuccess: () => setTexto("") })}
        >
          {t("Salvar anotação")}
        </Button>
        <Gravador aoGravar={(arquivo, duracao) => notas.enviarAudio.mutate({ arquivo, duracao })} desativado={salvando} />
        <Button variant="ghost" size="sm" disabled={salvando} onClick={() => arquivoRef.current?.click()}>
          <UploadSimple className="mr-1.5 h-4 w-4" aria-hidden /> {t("Enviar arquivo de áudio")}
        </Button>
        <input
          ref={arquivoRef}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-label={t("Arquivo de áudio")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) notas.enviarAudio.mutate({ arquivo: f, duracao: null });
            e.target.value = "";
          }}
        />
        {notas.enviarAudio.isPending && <span className="text-xs text-text-muted">{t("Salvando e transcrevendo o áudio…")}</span>}
      </div>
    </div>
  );
}

function Gravador({ aoGravar, desativado }: { aoGravar: (b: Blob, duracao: number) => void; desativado: boolean }) {
  const t = useT();
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<{ r: MediaRecorder; partes: Blob[]; inicio: number; timer: number; descartar: boolean } | null>(null);

  // Saiu da aba gravando: desliga o microfone e descarta — nada é enviado.
  useEffect(
    () => () => {
      const atual = rec.current;
      if (atual && atual.r.state !== "inactive") {
        atual.descartar = true;
        atual.r.stop();
      }
    },
    [],
  );

  async function comecar() {
    setErro(null);
    const mime =
      typeof MediaRecorder !== "undefined" ? mimeDeGravacao((m) => MediaRecorder.isTypeSupported(m)) : null;
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setErro(t("Este navegador não grava áudio. Envie um arquivo de áudio."));
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: mime });
      const ativo = stream;
      const estado = { r, partes: [] as Blob[], inicio: Date.now(), timer: 0, descartar: false };
      r.ondataavailable = (e) => e.data.size > 0 && estado.partes.push(e.data);
      r.onstop = () => {
        ativo.getTracks().forEach((tr) => tr.stop());
        window.clearInterval(estado.timer);
        setGravando(false);
        if (!estado.descartar && estado.partes.length) {
          aoGravar(new Blob(estado.partes, { type: mime.split(";")[0] }), Math.round((Date.now() - estado.inicio) / 1000));
        }
      };
      estado.timer = window.setInterval(() => {
        const s = Math.round((Date.now() - estado.inicio) / 1000);
        setSegundos(s);
        if (s >= LIMITE_DA_GRAVACAO_S) r.stop();
      }, 500);
      rec.current = estado;
      setSegundos(0);
      setGravando(true);
      r.start();
    } catch {
      stream?.getTracks().forEach((tr) => tr.stop());
      setErro(t("Não consegui usar o microfone. Libere o acesso no navegador."));
    }
  }

  function parar(descartar: boolean) {
    if (!rec.current) return;
    rec.current.descartar = descartar;
    rec.current.r.stop();
  }

  if (gravando) {
    const mm = String(Math.floor(segundos / 60)).padStart(1, "0");
    const ss = String(segundos % 60).padStart(2, "0");
    return (
      <span className="flex items-center gap-2" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
        <span className="text-sm tabular-nums">{t("Gravando")} {mm}:{ss}</span>
        <Button size="sm" onClick={() => parar(false)}>{t("Parar e salvar")}</Button>
        <Button size="sm" variant="ghost" onClick={() => parar(true)} aria-label={t("Descartar gravação")}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </span>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" disabled={desativado} onClick={comecar}>
        <Microphone className="mr-1.5 h-4 w-4" aria-hidden /> {t("Gravar áudio")}
      </Button>
      {erro && <span className="text-xs text-destructive">{erro}</span>}
    </>
  );
}

function ItemDeAnotacao({ anotacao: a, notas }: { anotacao: Anotacao; notas: Notas }) {
  const t = useT();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(a.body ?? "");

  return (
    <Card className="space-y-2 p-3" data-testid="item-anotacao">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <time dateTime={a.criadaEm} className="font-medium text-text">{quando(a.criadaEm)}</time>
        <span>{a.autor?.nome ?? t("Equipe")}</span>
        <Badge variant="outline">{a.kind === "audio" ? (a.daConversa ? t("Áudio do lead") : t("Áudio")) : t("Texto")}</Badge>
        {a.editadaEm && <span>({t("editada")})</span>}
        {a.podeEditar && !editando && (
          <span className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" aria-label={t("Editar anotação")} onClick={() => { setTexto(a.body ?? ""); setEditando(true); }}>
              <PencilSimple className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("Apagar anotação")}
              onClick={() => window.confirm(t("Apagar esta anotação?")) && notas.apagar.mutate(a.id)}
            >
              <Trash className="h-4 w-4" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      {a.audioUrl && <audio controls preload="none" src={a.audioUrl} className="h-9 w-full max-w-md" />}
      {editando ? (
        <div className="space-y-2">
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={5000} rows={3} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!texto.trim() || notas.editar.isPending} onClick={() => notas.editar.mutate({ id: a.id, body: texto.trim() }, { onSuccess: () => setEditando(false) })}>
              {t("Salvar")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>{t("Cancelar")}</Button>
          </div>
        </div>
      ) : a.body ? (
        <p className="whitespace-pre-wrap text-sm">{a.body}</p>
      ) : a.kind === "audio" ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted" data-testid="sem-transcricao">
          {a.status === "unavailable"
            ? t("Transcrição indisponível: a empresa não tem IA de áudio configurada.")
            : a.status === "pending"
              ? t("Transcrevendo…")
              : t("A transcrição falhou.")}
          {a.podeEditar && a.status !== "pending" && (
            <Button size="sm" variant="outline" disabled={notas.transcreverDeNovo.isPending} onClick={() => notas.transcreverDeNovo.mutate(a.id)}>
              {t("Tentar transcrever de novo")}
            </Button>
          )}
        </p>
      ) : null}
    </Card>
  );
}

const SITUACAO: Record<string, string> = { pending: "Pendente", in_progress: "Em andamento", done: "Concluída", cancelled: "Cancelada" };

function ItemDeTarefa({ tarefa }: { tarefa: Tarefa }) {
  const t = useT();
  return (
    <Card className="flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-sm" data-testid="item-tarefa">
      <time dateTime={tarefa.created_at} className="text-xs font-medium">{quando(tarefa.created_at)}</time>
      <ListChecks className="h-4 w-4 text-text-muted" aria-hidden />
      <span className={tarefa.status === "done" ? "line-through text-text-muted" : "font-medium"}>{tarefa.title}</span>
      {tarefa.due_date && <span className="text-xs text-text-muted">· {t("vence")} {quando(tarefa.due_date)}</span>}
      <Badge variant="outline" className="ml-auto">{t(SITUACAO[tarefa.status] ?? tarefa.status)}</Badge>
    </Card>
  );
}

function ResumoDaIA({ contactId, campoResumo, camposAtuais }: { contactId: string; campoResumo: string | null; camposAtuais: Record<string, unknown> }) {
  const t = useT();
  const gerar = useResumoDoLead(contactId);
  const salvar = useUpdateContact(contactId);
  const [resumo, setResumo] = useState<ResumoDoLead | null>(null);
  const [salvo, setSalvo] = useState(false);

  const pedir = () => {
    setSalvo(false);
    gerar.mutate(undefined, { onSuccess: setResumo });
  };

  return (
    <Card className="space-y-3 border-accent/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkle className="h-4 w-4 text-accent" aria-hidden />
        <h3 className="text-sm font-semibold">{t("Resumo da IA")}</h3>
        {resumo && <span className="text-xs text-text-muted">{t("Gerado em")} {quando(resumo.geradoEm)}</span>}
        <Button size="sm" className="ml-auto" disabled={gerar.isPending} onClick={pedir}>
          {gerar.isPending ? t("Gerando…") : resumo ? t("Gerar de novo") : t("Gerar resumo")}
        </Button>
      </div>
      {resumo ? (
        <>
          <div className="whitespace-pre-wrap text-sm" data-testid="texto-do-resumo">{resumo.texto}</div>
          {campoResumo && !resumo.semDados && (
            <Button
              size="sm"
              variant="outline"
              disabled={salvar.isPending || salvo}
              onClick={() =>
                salvar.mutate(
                  { custom_fields: { ...camposAtuais, [campoResumo]: resumo.texto } },
                  { onSuccess: () => setSalvo(true) },
                )
              }
            >
              {salvo ? t("Salvo no campo Resumo") : t("Salvar no campo Resumo")}
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {t("Junta a ficha, as anotações, as tarefas, o funil, os agendamentos e a conversa num texto curto.")}
        </p>
      )}
    </Card>
  );
}

function AudiosDaConversa({ contactId, aberto, aoFechar, notas }: { contactId: string; aberto: boolean; aoFechar: () => void; notas: Notas }) {
  const t = useT();
  const audios = useAudiosDaConversa(contactId, aberto);
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Áudios que o lead mandou")}</DialogTitle>
        </DialogHeader>
        {audios.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !audios.data?.length ? (
          <p className="text-sm text-text-muted">{t("Este lead ainda não mandou áudio pelo WhatsApp.")}</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {audios.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-md border border-border p-2">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="text-xs font-medium">{quando(a.enviadoEm)}</div>
                  <div className="truncate text-text-muted">{a.trecho ?? t("(ainda sem transcrição)")}</div>
                </div>
                <Button
                  size="sm"
                  disabled={!a.temArquivo || notas.usarAudioDaConversa.isPending}
                  onClick={() => notas.usarAudioDaConversa.mutate(a.id, { onSuccess: aoFechar })}
                >
                  {a.temArquivo ? t("Virar anotação") : t("Arquivo expirado")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
