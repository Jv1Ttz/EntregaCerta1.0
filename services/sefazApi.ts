import { Invoice, DeliveryStatus } from '../types';

interface SefazResponse {
  success: boolean;
  data?: Partial<Invoice>;
  error?: string;
}

export const sefazApi = {
  fetchNFeData: async (accessKey: string): Promise<SefazResponse> => {
    try {
      // 1. Limpa a chave (deixa só números)
      const cleanKey = accessKey.replace(/\D/g, '');
      
      if (cleanKey.length !== 44) {
        return { success: false, error: "Chave inválida. Deve ter 44 dígitos." };
      }

      // 2. Chama a API Pública (BrasilAPI)
      console.log(`Consultando BrasilAPI para a chave: ${cleanKey}...`);
      const response = await fetch(`https://brasilapi.com.br/api/nfe/v1/${cleanKey}`);
      
      if (!response.ok) {
        throw new Error('Nota não encontrada na base pública ou API indisponível.');
      }

      const data = await response.json();

      // 3. Monta o objeto Invoice com os dados REAIS que voltaram
      const newInvoice: Invoice = {
        id: `inv-${Date.now()}`,
        access_key: cleanKey,
        // Tenta pegar o número da nota do retorno ou extrai da chave
        number: data.numero || cleanKey.substring(25, 34), 
        series: data.serie || cleanKey.substring(22, 25),
        
        // Dados do Cliente / Destinatário
        customer_name: data.destinatario?.nome || "Consumidor Final / Não Identificado",
        customer_doc: data.destinatario?.cpf || data.destinatario?.cnpj || "",
        
        // Endereço (A API as vezes omite por privacidade, então tratamos isso)
        customer_address: data.destinatario?.endereco 
            ? `${data.destinatario.endereco.logradouro}, ${data.destinatario.endereco.numero} - ${data.destinatario.endereco.bairro}`
            : "Endereço não retornado (Preencher na entrega)",
        customer_zip: data.destinatario?.endereco?.cep || "",
        
        // Valor real da nota
        value: Number(data.valor_total) || 0,
        
        status: DeliveryStatus.PENDING,
        driver_id: null,
        vehicle_id: null,
        created_at: new Date().toISOString()
      };
      
      return { success: true, data: newInvoice };

    } catch (error) {
      console.error("Erro na consulta API:", error);
      return { 
        success: false, 
        error: "Não foi possível buscar os dados automaticamente. Tente a importação via XML." 
      };
    }
  }
};