/**
 * Mostra `**assim**` em negrito, sem interpretar mais nada (nem HTML): é o
 * formato que o Resumo da IA devolve. Cada título em negrito depois do
 * primeiro começa numa linha nova (se o texto já não pulou linha), para o
 * resumo ler como seções.
 */
import { Fragment } from "react";

const TERMINA_EM_QUEBRA = /\n\s*$/;

export function TextoComNegrito({ texto }: { texto: string }) {
  const partes = texto.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {partes.map((parte, i) => {
        if (i % 2 === 1) {
          const quebrar = i > 1 && !TERMINA_EM_QUEBRA.test(partes[i - 1] ?? "");
          return (
            <Fragment key={i}>
              {quebrar && <br />}
              <strong className="font-semibold">{parte}</strong>
            </Fragment>
          );
        }
        const limpo = i > 0 && !parte.startsWith("\n") ? parte.replace(/^[ \t]+/, " ") : parte;
        return <Fragment key={i}>{limpo}</Fragment>;
      })}
    </>
  );
}
