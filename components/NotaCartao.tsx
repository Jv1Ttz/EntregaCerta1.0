import React, { useMemo, useState } from 'react';
import { Invoice, Driver, Vehicle, DeliveryStatus } from '../types';
import { CheckCircle, Clock, Truck, AlertTriangle, AlertOctagon, RotateCw, FileText, ExternalLink, Satellite, MapPin, User, Package, List, Loader2, Search } from 'lucide-react';

/**
 * Cartão de UMA nota, aberto pelo link direto (#vendedor?nf=37318). Quem chega
 * pelo link da outra aplicação quer saber de uma nota só — chegou? quando chega?
 * — e a tabela com uma linha não respondia isso de cara.
 *
 * Os números de NF se repetem entre as três empresas (ver multi-emitente): se o
 * número achar mais de uma nota, o cartão pede para escolher pelo cliente.
 */

interface NotaCartaoProps {
  numero: string;
  notas: Invoice[];
  carregando: boolean;
  drivers: Driver[];
  vehicles: Vehicle[];
  carregandoComprovante: string | null;
  onComprovante: (inv: Invoice) => void;
  onSSW: (inv: Invoice) => void;
  onVerNoMapa: (inv: Invoice) => void;
  onVerTodas: () => void;
}

const semZeros = (n: string) => n.replace(/\D/g, '').replace(/^0+/, '');

const dataHora = (iso?: string | null) => {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const moeda = (v?: number) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Status em linguagem de vendedor, com a cor do selo e o ícone. */
function situacao(inv: Invoice): { titulo: string; detalhe: string; cor: string; icone: React.ReactNode } {
  switch (inv.status) {
    case DeliveryStatus.PENDING:
      return { titulo: 'Faturada', detalhe: 'Aguardando sair para entrega', cor: 'bg-amber-500', icone: <Clock size={22} /> };
    case DeliveryStatus.IN_PROGRESS:
      return { titulo: 'Em rota', detalhe: 'Saiu para entrega', cor: 'bg-blue-600', icone: <Truck size={22} /> };
    case DeliveryStatus.DELIVERED:
      return { titulo: 'Entregue', detalhe: 'Entrega confirmada pelo motorista', cor: 'bg-emerald-600', icone: <CheckCircle size={22} /> };
    case DeliveryStatus.ISSUE:
      return { titulo: 'Entregue com pendência', detalhe: 'Entregue, com avaria registrada', cor: 'bg-orange-500', icone: <AlertOctagon size={22} /> };
    case DeliveryStatus.FAILED:
      if (inv.return_final_status === 'CONCLUDED')
        return { titulo: 'Devolução concluída', detalhe: 'Mercadoria voltou e a devolução foi encerrada', cor: 'bg-slate-600', icone: <RotateCw size={22} /> };
      return { titulo: 'Não entregue', detalhe: 'Devolvida ou com devolução em aberto', cor: 'bg-red-600', icone: <AlertTriangle size={22} /> };
    case DeliveryStatus.RETURNED:
      return { titulo: 'Devolvida', detalhe: 'Mercadoria devolvida', cor: 'bg-purple-600', icone: <RotateCw size={22} /> };
    default:
      return { titulo: inv.status, detalhe: '', cor: 'bg-slate-500', icone: <Package size={22} /> };
  }
}

export const NotaCartao: React.FC<NotaCartaoProps> = ({
  numero, notas, carregando, drivers, vehicles, carregandoComprovante,
  onComprovante, onSSW, onVerNoMapa, onVerTodas,
}) => {
  const achadas = useMemo(
    () => notas.filter(i => semZeros(i.number) === semZeros(numero)),
    [notas, numero]
  );
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const inv = achadas.length === 1 ? achadas[0] : achadas.find(i => i.id === escolhida) ?? null;

  const rodape = (
    <button
      onClick={onVerTodas}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
    >
      <List size={16} /> Ver todas as minhas notas
    </button>
  );

  if (carregando) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 flex flex-col items-center gap-3 text-slate-400">
        <Loader2 size={32} className="animate-spin text-emerald-500" />
        <span className="text-sm">Buscando a NF {numero}...</span>
      </div>
    );
  }

  if (achadas.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center space-y-2 shadow-sm">
          <Search size={36} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="font-semibold text-slate-700 dark:text-slate-200">NF {numero} não encontrada</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ela ainda pode não ter chegado ao EntregaCerta, ou não é uma nota sua.
          </p>
        </div>
        {rodape}
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3 shadow-sm">
          <p className="font-semibold text-slate-700 dark:text-slate-200">Existe mais de uma NF {numero}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Cada empresa do grupo tem a sua numeração. Qual é a do seu pedido?</p>
          <div className="space-y-2">
            {achadas.map(a => (
              <button
                key={a.id}
                onClick={() => setEscolhida(a.id)}
                className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-600 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              >
                <div className="font-medium text-slate-800 dark:text-slate-100">{a.customer_name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {[a.end_municipio, moeda(a.value), dataHora(a.created_at)].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </div>
        {rodape}
      </div>
    );
  }

  const s = situacao(inv);
  const motorista = drivers.find(d => d.id === inv.driver_id);
  const veiculo = vehicles.find(v => v.id === inv.vehicle_id);
  const ehTransportadora = motorista?.name?.trim().toUpperCase() === 'TRANSPORTADORA';
  const saiu = inv.status !== DeliveryStatus.PENDING;
  const terminou = !!inv.delivered_at || [DeliveryStatus.DELIVERED, DeliveryStatus.ISSUE, DeliveryStatus.FAILED, DeliveryStatus.RETURNED].includes(inv.status);
  const entregou = inv.status === DeliveryStatus.DELIVERED || inv.status === DeliveryStatus.ISSUE;

  const etapas = [
    { nome: 'Faturada', quando: dataHora(inv.created_at), feita: true },
    {
      nome: 'Saiu para entrega',
      // A nota não guarda quando saiu; o início da rota do motorista serve só se
      // for depois do faturamento — motorista que não encerra a rota fica com
      // um início de semanas atrás, e mostrar isso seria informação errada.
      quando: inv.status === DeliveryStatus.IN_PROGRESS && motorista?.route_started_at
        && motorista.route_started_at > inv.created_at ? dataHora(motorista.route_started_at) : null,
      feita: saiu,
    },
    {
      nome: terminou ? (entregou ? 'Entregue' : 'Não entregue') : 'Entrega',
      quando: dataHora(inv.delivered_at),
      feita: terminou,
      problema: terminou && !entregou,
    },
  ];

  const endereco = [inv.end_logradouro, inv.end_bairro].filter(Boolean).join(', ')
    || inv.customer_address;
  const cidade = [inv.end_municipio, inv.end_uf].filter(Boolean).join(' / ');

  const info: Array<[React.ReactNode, string, string | null | undefined]> = [
    [<User size={14} />, 'Motorista', motorista?.name],
    [<Truck size={14} />, 'Veículo', veiculo ? `${veiculo.plate}${veiculo.model ? ` — ${veiculo.model}` : ''}` : null],
    [<Package size={14} />, 'Volumes', inv.cargo_volume_count
      ? `${inv.cargo_volume_count} ${inv.cargo_volume_type || 'vol.'}${inv.cargo_weight_gross ? ` · ${inv.cargo_weight_gross.toLocaleString('pt-BR')} kg` : ''}`
      : null],
  ];

  const botao = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
        {/* Situação */}
        <div className={`${s.cor} text-white px-5 py-4 flex items-center gap-3`}>
          {s.icone}
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight">{s.titulo}</div>
            <div className="text-sm opacity-90">{s.detalhe}</div>
          </div>
          <div className="ml-auto text-right shrink-0">
            <div className="text-xs uppercase tracking-wide opacity-80">NF</div>
            <div className="font-mono text-lg font-bold">{inv.number}</div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Cliente */}
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 text-base">{inv.customer_name}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">{inv.customer_doc}</div>
            {(endereco || cidade) && (
              <div className="mt-1 flex items-start gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                <span>{[endereco, cidade].filter(Boolean).join(' — ')}</span>
              </div>
            )}
            <div className="mt-2 text-xl font-bold text-slate-800 dark:text-white tabular-nums">{moeda(inv.value)}</div>
          </div>

          {/* Linha do tempo */}
          <ol className="relative border-l-2 border-slate-200 dark:border-slate-700 ml-2 space-y-4">
            {etapas.map(e => (
              <li key={e.nome} className="pl-5 relative">
                <span className={`absolute -left-[9px] top-0.5 h-4 w-4 rounded-full border-2 ${e.problema ? 'bg-red-500 border-red-500' : e.feita ? 'bg-emerald-500 border-emerald-500' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'}`} />
                <div className={`text-sm font-medium ${e.feita ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{e.nome}</div>
                {e.quando && <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{e.quando}</div>}
              </li>
            ))}
          </ol>

          {/* Motivo da falha / devolução */}
          {(inv.last_failure_reason || (inv.delivery_attempts ?? 0) > 1) && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-300 space-y-0.5">
              {inv.last_failure_reason && <div><span className="font-semibold">Motivo:</span> {inv.last_failure_reason}</div>}
              {(inv.delivery_attempts ?? 0) > 1 && <div><span className="font-semibold">Tentativas:</span> {inv.delivery_attempts}</div>}
              {!!inv.return_value && <div><span className="font-semibold">Valor devolvido:</span> {moeda(inv.return_value)}</div>}
            </div>
          )}

          {/* Quem leva */}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {info.filter(([, , v]) => v).map(([icone, rotulo, valor]) => (
              <div key={rotulo} className="rounded-lg bg-slate-50 dark:bg-slate-900/40 p-3 min-w-0">
                <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">{icone}{rotulo}</dt>
                <dd className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate" title={valor ?? ''}>{valor}</dd>
              </div>
            ))}
          </dl>

          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            {/* Transportadora não tem caminhão nosso no mapa: o rastreio é o SSW. */}
            {inv.status === DeliveryStatus.IN_PROGRESS && inv.vehicle_id && !ehTransportadora && (
              <button onClick={() => onVerNoMapa(inv)} className={`${botao} bg-blue-600 text-white hover:bg-blue-700`}>
                <Satellite size={16} /> Ver caminhão e previsão
              </button>
            )}
            {(inv.status === DeliveryStatus.DELIVERED || inv.status === DeliveryStatus.FAILED || inv.status === DeliveryStatus.ISSUE) && (
              <button
                onClick={() => onComprovante(inv)}
                disabled={carregandoComprovante === inv.id}
                className={`${botao} bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60`}
              >
                {carregandoComprovante === inv.id ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                Ver comprovante
              </button>
            )}
            {ehTransportadora && (
              <button onClick={() => onSSW(inv)} className={`${botao} bg-sky-600 text-white hover:bg-sky-700`}>
                <ExternalLink size={16} /> Rastrear na transportadora
              </button>
            )}
            {inv.pdf_url && (
              <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
                className={`${botao} border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700`}>
                <ExternalLink size={16} /> DANFE (PDF)
              </a>
            )}
          </div>
        </div>
      </div>
      {rodape}
    </div>
  );
};
