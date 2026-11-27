/**
 * Mostra `**assim**` em negrito, sem interpretar mais nada (nem HTML): é o
 * formato que o Resumo da IA devolve. Cada título em negrito depois do
 * primeiro começa numa linha nova, para o resumo ler como seções.
 */
import { Fragment } from "react";

export function TextoComNegrito({ texto }: { texto: string }) {
  const partes = texto.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <Fragment key={i}>
            {i > 1 && !/
s*$/.test(partes[i - 1] ?? "") && <br />}
            <strong className="font-semibold">{parte}</strong>
          </Fragment>
        ) : (
          <Fragment key={i}>{i > 0 ? parte.replace(/^\s+/, " ") : parte}</Fragment>
        ),
      )}
    </>
  );
}
