## 🚚 EntregaCerta
Sistema completo de gestão logística e entregas last-mile, composto por um Painel Administrativo Web e um Aplicativo Mobile para motoristas.

**📋 Sobre o Projeto**
O EntregaCerta soluciona o problema de rastreabilidade e gestão de entregas. Ele permite que gestores importem notas fiscais (XML), distribuam cargas para motoristas e acompanhem o status em tempo real. Para os motoristas, oferece um aplicativo simples para navegação e comprovação de entrega digital.

**✨ Funcionalidades Principais**

🖥️ Painel Administrativo (Web)
Dashboard Financeiro: Visão geral de valores entregues, devoluções e pendências.

Importação Inteligente: Drag & Drop de arquivos XML de NF-e com leitura automática de dados.

Gestão de Frota: Cadastro de motoristas e veículos.

Monitoramento em Tempo Real: Mapa interativo (Mapbox) mostrando a localização da frota e status das entregas.

Controle de Ocorrências: Fluxo dedicado para tratativa de avarias, erros de separação e reentregas.

Impressão de Comprovantes: Geração de comprovante digital com foto e assinatura.

**📱 Aplicativo do Motorista (Mobile)**

Lista de Entregas: Visualização clara das notas pendentes e roteirização.

Comprovante Digital: Coleta de assinatura na tela e foto do local/mercadoria.

Reporte de Problemas: Fluxo específico para registrar avarias ou insucessos (cliente ausente).

Geolocalização: Captura automática de coordenadas (GPS) no ato da baixa.

Leitor de Código de Barras: Scanner integrado para conferência de notas.

**🛠️ Tecnologias Utilizadas**

Front-end: React.js, Vite

Linguagem: TypeScript

Estilização: Tailwind CSS, Lucide React (Ícones)

Mobile Wrapper: Capacitor (Geração de APK Android)

Backend / Database: Supabase (PostgreSQL, Auth, Storage, Realtime)

Mapas: Mapbox GL JS

Outros: fast-xml-parser (Leitura de NF-e), html5-qrcode (Scanner).

*Desenvolvido por João Vitor da empresa Ello*