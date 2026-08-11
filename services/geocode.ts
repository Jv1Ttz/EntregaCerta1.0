import { Invoice } from '../types';
import { db } from './db';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';

/** Centro de Salvador — viés de busca, não filtro: entrega interestadual continua achando. */
const VIES_SALVADOR = '-38.5108,-12.9777';

/**
 * Granularidades que representam a região inteira, não um ponto de entrega.
 * Aceitar uma destas era o que produzia o "pino genérico": uma única coordenada
 * servindo a dezenas de endereços diferentes, com o motorista mandado ao centro
 * da cidade em vez do cliente.
 */
const TIPOS_GENERICOS = ['region', 'country', 'place', 'district', 'locality'];

/** Abaixo disto o Mapbox está claramente chutando. */
const RELEVANCIA_MINIMA = 0.6;

export interface ResultadoGeo {
  lat: number;
  lng: number;
  relevancia: number;
}

/**
 * Converte endereço em coordenada. Devolve null quando não dá para confiar no
 * resultado — nota sem pino é melhor que nota com pino errado, que manda o
 * motorista para o lugar errado com aparência de certeza.
 *
 * O CEP NÃO entra na busca de propósito. Foi testado: o Mapbox interpreta CEP
 * brasileiro muito mal (para 41235-015, de Salvador, devolveu um endereço em
 * Recife com relevância 0.89) e, medido em 25 notas reais, incluí-lo não mudou
 * nenhum resultado. É risco sem retorno — não readicione sem medir de novo.
 */
export const geocodeEndereco = async (endereco: string): Promise<ResultadoGeo | null> => {
  if (!MAPBOX_TOKEN) return null;

  // O "|| OBS/LOCAL" é observação da nota, não faz parte do endereço.
  const limpo = (endereco || '').split('||')[0].trim();
  if (!limpo) return null;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(limpo + ', Brasil')}.json`
    + `?access_token=${MAPBOX_TOKEN}&limit=1&country=br&language=pt&proximity=${VIES_SALVADOR}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const achado = data?.features?.[0];
    if (!achado?.center) return null;

    const relevancia = typeof achado.relevance === 'number' ? achado.relevance : 0;
    if (relevancia < RELEVANCIA_MINIMA) return null;

    const tipos: string[] = achado.place_type || [];
    if (tipos.some(t => TIPOS_GENERICOS.includes(t))) return null;

    const [lng, lat] = achado.center;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    return { lat, lng, relevancia };
  } catch {
    return null;
  }
};

/**
 * Geocodifica a nota e persiste a coordenada. Nota que já tem coordenada não
 * gasta chamada de API. Falha em silêncio: ficar sem pino é um estado válido.
 */
export const geocodeInvoice = async (invoice: Invoice): Promise<Invoice> => {
  if (invoice.lat && invoice.lng) return invoice;

  const geo = await geocodeEndereco(invoice.customer_address);
  if (!geo) return invoice;

  try {
    await db.updateInvoiceLocation(invoice.id, geo.lat, geo.lng);
  } catch (e) {
    console.error(`Não foi possível salvar a localização da NF ${invoice.number}:`, e);
  }
  return { ...invoice, lat: geo.lat, lng: geo.lng };
};
