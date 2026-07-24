/**
 * Motivos padronizados de devolução.
 *
 * As categorias saíram do histórico real de delivery_proofs.failure_reason: o
 * campo era texto livre e a mesma ocorrência aparecia escrita de vários jeitos
 * ("Cliente n quis", "cliente não aceitou a mercadoria", "Cliente nao quis o
 * produto"), além de registros sem informação nenhuma ("concluir devolução",
 * "Devolveu"). O código escolhido aqui vai para failure_reason_code; o texto
 * livre vira só um detalhe opcional.
 *
 * Ao mexer nesta lista: nunca reaproveite um `code` para outro significado —
 * os registros antigos continuam apontando para ele.
 */

export interface ReturnReason {
  code: string;
  label: string;
  /** Ajuda o motorista a escolher certo quando o rótulo sozinho é ambíguo. */
  hint?: string;
}

/**
 * Motivos de "Não entregue hoje" — a nota não foi realizada (nem entregue, nem
 * devolvida, nem pendência) e volta para a fila. Não confundir com devolução:
 * aqui a mercadoria não chegou a ser recusada, só não deu pra entregar hoje.
 */
export const NAO_ENTREGUE_REASONS: string[] = [
  'Sem tempo / fim do expediente',
  'Cliente fechado / ausente',
  'Endereço não localizado',
  'Não coube no veículo',
  'Outro motivo',
];

/** Devolução total: a nota inteira volta. */
export const RETURN_REASONS_TOTAL: ReturnReason[] = [
  { code: 'CLIENTE_RECUSOU',     label: 'Cliente recusou a mercadoria' },
  { code: 'LOCAL_FECHADO',       label: 'Estabelecimento fechado / cliente ausente' },
  { code: 'JA_RECEBEU',          label: 'Cliente já recebeu a mercadoria', hint: 'Entrega duplicada' },
  { code: 'PRODUTO_DIVERGENTE',  label: 'Produto divergente do pedido' },
  { code: 'MARCA_DIFERENTE',     label: 'Marca diferente da pedida' },
  { code: 'ERRO_NOTA',           label: 'Erro na nota fiscal' },
  { code: 'ENDERECO_INCORRETO',  label: 'Endereço / destino incorreto' },
  { code: 'SOLICITADO_VENDEDOR', label: 'Devolução solicitada pelo vendedor' },
  { code: 'NAO_EMBARCADA',       label: 'Mercadoria não embarcada', hint: 'Não saiu com o veículo' },
  { code: 'AVARIA',              label: 'Mercadoria avariada' },
  { code: 'OUTRO',               label: 'Outro', hint: 'Descreva no campo abaixo' },
];

/** Devolução parcial: só alguns itens voltam. */
export const RETURN_REASONS_PARTIAL: ReturnReason[] = [
  { code: 'CLIENTE_RECUSOU_ITEM',  label: 'Cliente recusou o(s) item(ns)' },
  { code: 'PRODUTO_DIVERGENTE',    label: 'Produto divergente do pedido' },
  { code: 'MARCA_DIFERENTE',       label: 'Marca diferente da pedida' },
  { code: 'ESPECIFICACAO_ERRADA',  label: 'Especificação errada', hint: 'Tamanho, medida, cor, gramatura' },
  { code: 'QUANTIDADE_DIVERGENTE', label: 'Quantidade divergente da nota' },
  { code: 'DUPLICIDADE',           label: 'Faturamento em duplicidade' },
  { code: 'NAO_UTILIZA',           label: 'Cliente não utiliza o produto' },
  { code: 'QUALIDADE_REPROVADA',   label: 'Qualidade reprovada pelo cliente' },
  { code: 'SOLICITADO_VENDEDOR',   label: 'Devolução solicitada pelo vendedor' },
  { code: 'AVARIA',                label: 'Mercadoria avariada' },
  { code: 'OUTRO',                 label: 'Outro', hint: 'Descreva no campo abaixo' },
];

/** Exige o detalhe escrito — sozinho o código não diz nada. */
export const REASON_REQUIRES_DETAIL = 'OUTRO';

export const getReasonsFor = (returnType: 'TOTAL' | 'PARTIAL'): ReturnReason[] =>
  returnType === 'TOTAL' ? RETURN_REASONS_TOTAL : RETURN_REASONS_PARTIAL;

/** Rótulo a partir do código, para as telas de leitura. */
const ALL_REASONS = [...RETURN_REASONS_TOTAL, ...RETURN_REASONS_PARTIAL];

export const REASON_LABEL: Record<string, string> = ALL_REASONS.reduce(
  (acc, r) => { acc[r.code] = r.label; return acc; },
  {} as Record<string, string>,
);

/**
 * Um comprovante é de devolução/pendência (e não de entrega) quando tem motivo
 * — código ou texto — ou tipo de retorno.
 *
 * Não troque por `!!proof.failure_reason`: o texto livre virou opcional com a
 * padronização, então uma devolução sem detalhe escrito passaria por entrega.
 */
export const isReturnProof = (proof?: {
  failure_reason?: string | null;
  failure_reason_code?: string | null;
  return_type?: string | null;
}): boolean => !!(proof && (proof.failure_reason_code || proof.failure_reason || proof.return_type));

/**
 * Motivo pronto para exibição: "Rótulo padronizado — detalhe livre".
 * Registros anteriores à padronização não têm código e caem no texto puro.
 */
export const formatProofReason = (proof?: {
  failure_reason?: string | null;
  failure_reason_code?: string | null;
}): string => {
  if (!proof) return '';
  const detalhe = proof.failure_reason?.trim();
  if (!proof.failure_reason_code) return detalhe || '';
  const label = REASON_LABEL[proof.failure_reason_code] ?? proof.failure_reason_code;
  return detalhe ? `${label} — ${detalhe}` : label;
};
