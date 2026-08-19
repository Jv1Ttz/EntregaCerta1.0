# EntregaCerta — impressão automática do DANFE
#
# Roda no PC do galpão. A cada ciclo pergunta ao Supabase quais notas novas
# entraram, baixa o DANFE do Drive e manda para a impressora padrão do Windows.
#
# POR QUE UM AGENTE LOCAL: a ingestão roda no Google (Apps Script), que não
# enxerga impressora nenhuma da rede. Alguma coisa precisa rodar perto do papel.
#
# INSTALAÇÃO (uma vez):
#   1. Baixe o SumatraPDF portátil (gratuito) e coloque ao lado deste arquivo:
#      https://www.sumatrapdfreader.org/download-free-pdf-viewer  → versão "portable"
#      Renomeie para SumatraPDF.exe se vier com nome diferente.
#   2. Preencha SUPABASE_KEY abaixo (Supabase → Settings → API → anon public).
#   3. Teste:  powershell -ExecutionPolicy Bypass -File .\imprimir-danfe.ps1 -Simular
#   4. Agende no Agendador de Tarefas do Windows (instruções no final do arquivo).

param(
  # Não imprime: só mostra o que faria. Use na primeira vez.
  [switch]$Simular
)

# ─────────────────────────── CONFIGURAÇÃO ───────────────────────────
$SUPABASE_URL = "https://oomxnhgyxaimkvdllmao.supabase.co"
$SUPABASE_KEY = "COLE_AQUI_A_ANON_KEY"

# ── Etiqueta de expedição ──
# Impressora térmica própria, que fala ZPL direto pela rede (sem driver, sem PDF).
# Desligada por padrao: enquanto a etiqueta nao estiver homologada pelo gestor,
# ligar isso faz sair papel na termica a cada nota nova, de minuto em minuto.
# So vire para $true depois do de-acordo sobre o layout.
$IMPRIMIR_ETIQUETA = $false
$IP_ETIQUETA       = '10.9.74.176'
$PORTA_ETIQUETA    = 9100
$REMETENTE         = 'ELLO ATACADAO DE PRODUTOS LTDA'
# CNPJ da ELLO, lido da chave da NF-e (posições 7-20).
#
# O EntregaCerta entrega para TRÊS emitentes: ELLO (série 004), 31391511000105
# (série 002) e 01649999000167 (série 003) — 23% das notas recentes não são da
# ELLO. E os números se repetem entre eles: existe NF 6870 em mais de uma empresa.
#
# Sem este filtro acontecem duas coisas ruins, e as duas em silêncio:
#   1. a etiqueta sai com "REMETENTE: ELLO" numa mercadoria que não é da ELLO;
#   2. a consulta de carga no ERP da ELLO encontra OUTRA nota com o mesmo número
#      e devolve uma carga alheia — medido: NF 6870 devolveu a carga 2775.
# Carga errada na caixa é pior que carga nenhuma: manda a mercadoria para o
# lugar errado com aparência de estar certa.
$CNPJ_ELLO = '03326448000198'
$ETIQUETA_LARGURA  = 480   # 60mm a 203dpi (8 pontos por mm)
$ETIQUETA_ALTURA   = 720   # 90mm

# Teto de etiquetas por ciclo. NÃO é enfeite: medido em 113 notas reais, a média
# é de 10 volumes por nota, com casos de 80 e 143 — as 113 dariam 1.165 etiquetas.
# Sem teto, um ciclo com poucas notas grandes estoura o $PRAZO_MAXIMO_SEG no meio
# da impressão; como o progresso é gravado por volume, o ciclo seguinte retoma de
# onde parou em vez de recomeçar (que era o caminho para duplicar tudo).
$MAX_ETIQUETAS_POR_CICLO = 60

# Nome EXATO da impressora (como aparece em Dispositivos e Impressoras).
# Vazio = usa a padrao do Windows.
# Escolher pelo nome importa: a maquina pode ter mais de uma WF-M5799 instalada,
# e a padrao pode ser justamente a que nao responde.
# Para listar os nomes:  Get-Printer | Select-Object Name
$IMPRESSORA = "logistica (WF-M5799 Series)"

# Só imprime nota que entrou nas últimas N horas. Protege o caso de o PC ficar
# dias desligado: ao ligar, ele não despeja o acumulado inteiro na impressora.
$MAX_HORAS = 12

# Quantas notas no máximo por ciclo — trava de segurança contra enxurrada.
$MAX_POR_CICLO = 30

# Prazo máximo de um ciclo. Passou disso, ele se encerra sozinho: rodada travada
# não pode segurar o mutex e derrubar a impressão das notas seguintes.
$PRAZO_MAXIMO_SEG = 180

# Quanto esperar pela impressora antes de desistir de uma nota (segundos).
# Com a impressora offline o SumatraPDF fica pendurado: medido, chegou a 4 min
# numa nota só. Sem este limite o agente trava segurando a trava e nunca mais
# processa nada.
$TIMEOUT_IMPRESSAO_S = 90

$PASTA        = Split-Path -Parent $MyInvocation.MyCommand.Path
$SUMATRA      = Join-Path $PASTA "SumatraPDF.exe"
$ARQ_IMPRESSAS = Join-Path $PASTA "impressas.txt"   # memória: DANFEs que já saíram
# Etiqueta tem memória PRÓPRIA de propósito. Se as duas compartilhassem o mesmo
# controle, uma falha só (impressora de etiqueta offline, por exemplo) faria o
# DANFE ser reimpresso junto na tentativa seguinte — e a cada minuto, virando
# enxurrada de papel. Separados, cada um repete só o que faltou.
$ARQ_ETIQUETAS = Join-Path $PASTA "etiquetas.txt"
$ARQ_LOG       = Join-Path $PASTA "impressao.log"
$ARQ_PONTO     = Join-Path $PASTA "ultima-rodada.txt"  # batida de ponto p/ o vigia
$TEMP          = Join-Path $env:TEMP "entregacerta-danfe"

# ── Consulta de carga/pré-fatura no ERP Senior ──
# Credenciais ficam FORA deste arquivo, num senior.config ao lado, porque este
# script vive num repositório git. Formato do senior.config (uma chave por linha):
#   url=https://webp02.seniorcloud.com.br:30301/g5-senior-services/sapiens_Synccom_ello_coletor
#   usuario=...
#   senha=...
#   encryption=0
#   codemp=10
#   codfil=1
$ARQ_SENIOR = Join-Path $PASTA "senior.config"
$SENIOR = @{}
if (Test-Path $ARQ_SENIOR) {
  Get-Content $ARQ_SENIOR | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $k,$v = $_ -split '=',2
    $SENIOR[$k.Trim()] = $v.Trim()
  }
}
$PRAZO_SENIOR_SEG = 20
# Ver a explicação em ConsultarCargaERP: usar o curl do Windows, não o que estiver
# primeiro no PATH.
$CURL = Join-Path $env:SystemRoot 'system32\curl.exe'

# ─────────────────────────── APOIO ───────────────────────────

# Invoke-RestMethod/Invoke-WebRequest do PowerShell 5.1 ignoram -TimeoutSec quando
# a conexao trava no meio (handshake ou leitura parada). Ja aconteceu: uma rodada
# ficou 12 minutos pendurada na consulta, segurando o mutex, e toda rodada
# seguinte saiu calada — a impressao parou sem nenhum erro no log.
# HttpWebRequest permite prazo no socket, que e respeitado de verdade.
function BuscarComPrazo($url, $cabecalhos, $segundos = 25) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = 'GET'
  $req.Timeout = $segundos * 1000            # conexao + envio
  $req.ReadWriteTimeout = $segundos * 1000   # leitura da resposta
  foreach ($k in $cabecalhos.Keys) { $req.Headers.Add($k, $cabecalhos[$k]) }
  $resp = $req.GetResponse()
  try {
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    return $sr.ReadToEnd()
  } finally { $resp.Close() }
}

function BaixarComPrazo($url, $destino, $segundos = 45) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = 'GET'
  $req.Timeout = $segundos * 1000
  $req.ReadWriteTimeout = $segundos * 1000
  $req.AllowAutoRedirect = $true
  $resp = $req.GetResponse()
  try {
    $fs = [IO.File]::Create($destino)
    try { $resp.GetResponseStream().CopyTo($fs) } finally { $fs.Close() }
  } finally { $resp.Close() }
}

# Marca que um ciclo chegou ao fim com saude. O vigia usa este arquivo para
# saber se o agente esta vivo: ciclo travado nunca bate o ponto, e e justamente
# a falha silenciosa que precisamos enxergar (a fila para sem erro no log).
function BaterPonto {
  try { Set-Content -Path $ARQ_PONTO -Value (Get-Date -Format 'o') -Encoding utf8 } catch {}
}

function Registrar($texto) {
  $linha = "{0}  {1}" -f (Get-Date -Format "dd/MM HH:mm:ss"), $texto
  Write-Host $linha
  Add-Content -Path $ARQ_LOG -Value $linha -Encoding utf8
}

# ─────────────────────────── ETIQUETA (ZPL) ───────────────────────────

# ZPL trata ^ e ~ como início de comando, e acento não sai no charset padrão.
function LimparZPL($t) {
  if ($null -eq $t) { return '' }
  $s = [Text.Encoding]::ASCII.GetString([Text.Encoding]::GetEncoding('ISO-8859-8').GetBytes([string]$t))
  # O ERP grava campo vazio como "." — imprimir isso deixaria um ponto solto.
  if ($s.Trim() -eq '.') { return '' }
  return ($s -replace '[\^~]', ' ').Trim()
}

# Notas anteriores às colunas novas só têm o endereço concatenado. Como o formato
# é o nosso ("LOGRADOURO, N - BAIRRO, MUNICIPIO - UF"), dá para desmontar de trás
# para frente e a etiqueta sair completa também para elas.
function DesmontarEndereco($completo) {
  $r = @{ logradouro = ''; bairro = ''; municipio = ''; uf = '' }
  $t = (LimparZPL $completo).Split('||')[0].Trim()
  if (-not $t) { return $r }
  $i = $t.LastIndexOf(' - '); if ($i -gt 0) { $r.uf        = $t.Substring($i+3).Trim(); $t = $t.Substring(0,$i) }
  $i = $t.LastIndexOf(',');   if ($i -gt 0) { $r.municipio = $t.Substring($i+1).Trim(); $t = $t.Substring(0,$i) }
  $i = $t.LastIndexOf(' - '); if ($i -gt 0) { $r.bairro    = $t.Substring($i+3).Trim(); $t = $t.Substring(0,$i) }
  $r.logradouro = $t.Trim()
  return $r
}

function MontarZPL($n, $vol, $totalVol) {
  $cep = LimparZPL $n.customer_zip
  if ($cep.Length -eq 8) { $cep = $cep.Substring(0,5) + '-' + $cep.Substring(5) }

  $velho  = DesmontarEndereco $n.customer_address
  $logr   = if ($n.end_logradouro) { LimparZPL $n.end_logradouro } else { $velho.logradouro }
  $bairro = if ($n.end_bairro)     { LimparZPL $n.end_bairro }     else { $velho.bairro }
  $cidade = if ($n.end_municipio)  { LimparZPL $n.end_municipio }  else { $velho.municipio }
  $uf     = if ($n.end_uf)         { LimparZPL $n.end_uf }         else { $velho.uf }
  $vend   = LimparZPL $n.vendedor
  $ref    = LimparZPL $n.referencia

  $carga = LimparZPL $n.carga
  $pfa   = LimparZPL $n.prefatura

  # Layout espelhado na etiqueta do ERP: moldura externa, rótulo e valor na MESMA
  # linha, linhas separando os blocos.
  #
  # A altura de cada bloco acompanha quantas linhas o texto pode ocupar. A versão
  # anterior reservava uma linha para todos, e campos longos invadiam o bloco de
  # baixo — na NF 36184 o nome do cliente (39 caracteres) escreveu por cima do
  # endereço, e o endereço (74 caracteres) por cima do CEP.
  $LN = 26                                # altura de uma linha de texto
  $z = @('^XA', "^PW$ETIQUETA_LARGURA", "^LL$ETIQUETA_ALTURA", '^LH0,0', '^CI0')
  $z += "^FO6,6^GB468,708,3^FS"           # moldura externa

  $x = 18
  $y = 24

  # Blocos "RÓTULO: valor" declarados como dados, e desenhados num laço só.
  #
  # A primeira versão usava uma função auxiliar que avançava $script:y — que é
  # uma variável DIFERENTE do $y local desta função, e ainda por cima sobrevive
  # entre chamadas. O resultado foi cada etiqueta começar onde a anterior parou:
  # a NF 36132 desenhou até y=816 numa etiqueta de 714. Aqui o avanço é explícito.
  #
  # Endereço leva 3 linhas por ser o campo que mais estoura: medido, chega a 74
  # caracteres com complemento ("EDIF EMPRESARIAL ... SALA 807 E 808").
  $blocos = @(
    @{ rot='REMETENTE';    val=(LimparZPL $REMETENTE);       xv=150; larg=310; lin=1; fonte=20 },
    @{ rot='DESTINATARIO'; val=(LimparZPL $n.customer_name); xv=182; larg=280; lin=2; fonte=20 },
    @{ rot='ENDERECO';     val=$logr;                        xv=140; larg=320; lin=3; fonte=20 }
  )
  foreach ($b in $blocos) {
    $z += "^FO$x,$y^A0N,20,20^FD$($b.rot):^FS"
    if ($b.val) { $z += "^FO$($b.xv),$y^FB$($b.larg),$($b.lin),0,L^A0N,$($b.fonte),$($b.fonte)^FD$($b.val)^FS" }
    $y += ($LN * $b.lin) + 8
    $z += "^FO10,$($y-6)^GB460,1,1^FS"
  }

  # CEP e BAIRRO dividem a linha, como no original
  $z += "^FO$x,$y^A0N,20,20^FDCEP: $cep^FS"
  $z += "^FO210,$y^FB250,1,0,L^A0N,20,20^FDBAIRRO: $bairro^FS"; $y += $LN + 8
  $z += "^FO10,$($y-6)^GB460,1,1^FS"

  $z += "^FO$x,$y^A0N,20,20^FDDESTINO: $cidade^FS"
  $z += "^FO370,$y^A0N,20,20^FDUF: $uf^FS"; $y += $LN + 8
  $z += "^FO10,$($y-6)^GB460,1,1^FS"

  $z += "^FO$x,$y^A0N,20,20^FDVENDEDOR:^FS"
  if ($vend) { $z += "^FO150,$y^FB310,1,0,L^A0N,20,20^FD$vend^FS" }
  $y += $LN + 8
  $z += "^FO10,$($y-6)^GB460,1,1^FS"

  # Referência quase sempre vem vazia (3 de 113 notas medidas), mas quando vem
  # pode ser longa — uma tinha 90 caracteres, daí as 2 linhas.
  $z += "^FO$x,$y^A0N,20,20^FDREFERENCIA:^FS"
  if ($ref) { $z += "^FO160,$y^FB300,2,0,L^A0N,18,18^FD$ref^FS" }
  $y += ($LN * 2) + 8
  $z += "^FO10,$($y-6)^GB460,1,1^FS"

  # Bloco grande: nota fiscal à esquerda, volumes à direita
  $yg = $y + 10
  $z += "^FO$x,$yg^A0N,24,24^FDNOTA FISCAL:^FS"
  $z += "^FO40,$($yg+30)^A0N,58,58^FD$(LimparZPL $n.number)^FS"
  $z += "^FO$x,$($yg+96)^A0N,20,20^FDSERIE: $(LimparZPL $n.series)^FS"
  $z += "^FO270,$yg^A0N,26,26^FDVOLUMES:^FS"
  $z += "^FO288,$($yg+30)^A0N,50,50^FD$vol / $totalVol^FS"

  $yc = $yg + 128
  $z += "^FO10,$yc^GB460,1,1^FS"
  $z += "^FO$x,$($yc+12)^A0N,20,20^FDCarga/Pre-Fatura:   $carga  /  $pfa^FS"
  $z += '^XZ'
  return ($z -join "`r`n")
}

# Pergunta ao ERP a carga, a pré-fatura e a referência de uma nota.
#
# Devolve um objeto com .situacao, que é o que decide o comportamento:
#   OK              -> tem carga; imprime
#   SEM_CARGA       -> a nota existe no ERP mas não pertence a carga nenhuma.
#                      É DEFINITIVO, não adianta tentar de novo: a NF 36219 seguia
#                      assim 16h depois de emitida e já entregue. Vem sempre com
#                      volumes=0, que é o mesmo caso em que o ERP não imprime nada.
#   NAO_ENCONTRADA  -> a nota ainda não existe no ERP. É TRANSITÓRIO (o
#                      EntregaCerta às vezes recebe o XML antes), então tenta de novo.
#   ERRO            -> rede/serviço fora. Transitório também; não imprime nada
#                      pela metade, espera o próximo ciclo.
function ConsultarCargaERP($numeroNF) {
  $vazio = [pscustomobject]@{ situacao='ERRO'; carga=''; prefatura=''; volumes=0; referencia='' }
  if (-not $SENIOR.ContainsKey('url')) { return $vazio }

  $reqFile = Join-Path $TEMP "soap-$numeroNF.xml"
  $rspFile = Join-Path $TEMP "soap-$numeroNF-resp.xml"
  $envelope = @"
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://services.senior.com.br">
  <soapenv:Body>
    <ser:consulta_carga_nf>
      <user>$($SENIOR['usuario'])</user>
      <password>$($SENIOR['senha'])</password>
      <encryption>$($SENIOR['encryption'])</encryption>
      <parameters>
        <numnfv>$numeroNF</numnfv>
        <codsnf>NFE</codsnf>
        <codemp>$($SENIOR['codemp'])</codemp>
        <codfil>$($SENIOR['codfil'])</codfil>
        <cnpj>0</cnpj>
      </parameters>
    </ser:consulta_carga_nf>
  </soapenv:Body>
</soapenv:Envelope>
"@
  try {
    Set-Content -Path $reqFile -Value $envelope -Encoding UTF8 -NoNewline
    # curl.exe e nao Invoke-WebRequest: o PowerShell 5.1 falhou o handshake TLS
    # com este servidor em todos os endpoints, inclusive nos que sabidamente
    # funcionam. O curl passa direto.
    #
    # Caminho ABSOLUTO de proposito. Se o PATH tiver o curl do Git (MSYS) na
    # frente, ele converte o "@C:\..." do --data-binary e envia corpo VAZIO; o
    # servidor responde "Corpo da mensagem esta vazio" e o agente leria isso
    # como ERP fora do ar, em toda nota, sem nenhum sinal do motivo real.
    & $CURL -s -k -o $rspFile --max-time $PRAZO_SENIOR_SEG `
      -X POST $SENIOR['url'] `
      -H "Content-Type: text/xml; charset=UTF-8" -H "SOAPAction: `"`"" `
      --data-binary "@$reqFile" 2>$null | Out-Null

    if (-not (Test-Path $rspFile)) { return $vazio }
    $r = Get-Content $rspFile -Raw
    $campo = {
      param($t)
      $m = [regex]::Match($r, "<$t>(.*?)</$t>")
      if ($m.Success) { $m.Groups[1].Value } else { '' }
    }
    $sit = (& $campo 'situacao')
    if (-not $sit) { return $vazio }
    return [pscustomobject]@{
      situacao   = $sit
      carga      = (& $campo 'numane')
      prefatura  = (& $campo 'numpfa')
      volumes    = [int]((& $campo 'volnfv') -replace '[^\d]','0')
      referencia = (& $campo 'referencia')
    }
  } catch {
    return $vazio
  } finally {
    Remove-Item $reqFile,$rspFile -Force -ErrorAction SilentlyContinue
  }
}

# Imprime as etiquetas que ainda faltam desta nota, uma por volume.
#
# Retoma de onde parou: recebe quantas já saíram e continua do volume seguinte.
# Isso existe porque uma nota pode ter 143 volumes — mais do que cabe num ciclo.
# Devolve quantas imprimiu AGORA (o chamador soma ao progresso e regrava).
#
# Respeita $restanteNoCiclo para não estourar o prazo da rodada no meio de um
# lote grande.
function ImprimirEtiquetas($n, $jaFeitas, $restanteNoCiclo) {
  # O ERP imprime uma etiqueta por volume declarado; com zero volumes ele não
  # imprime NADA. Medido: 18% das notas têm volume zero (serviço, coleta, etc).
  # Sem esta guarda, o agente colaria etiqueta em 1 de cada 5 notas que o ERP
  # deliberadamente ignora.
  $total = [int]$n.volumes
  if ($total -le 0) { return 0 }
  if ($jaFeitas -ge $total) { return 0 }

  $ate = [Math]::Min($total, $jaFeitas + $restanteNoCiclo)
  $feitas = 0
  try {
    $cli = New-Object System.Net.Sockets.TcpClient
    if (-not $cli.BeginConnect($IP_ETIQUETA,$PORTA_ETIQUETA,$null,$null).AsyncWaitHandle.WaitOne(5000)) {
      throw "impressora de etiqueta nao respondeu em $IP_ETIQUETA"
    }
    $st = $cli.GetStream()
    for ($v = $jaFeitas + 1; $v -le $ate; $v++) {
      $b = [Text.Encoding]::ASCII.GetBytes((MontarZPL $n $v $total))
      $st.Write($b,0,$b.Length); $st.Flush()
      $feitas++
      Start-Sleep -Milliseconds 200
    }
    $st.Close(); $cli.Close()
    $ondeParou = $jaFeitas + $feitas
    if ($ondeParou -lt $total) {
      Registrar "  NF $($n.number): etiquetas $($jaFeitas+1)-$ondeParou de $total (continua no proximo ciclo)"
    } else {
      Registrar "  NF $($n.number): $total etiqueta(s) concluida(s)"
    }
    return $feitas
  } catch {
    # Devolve o que já saiu antes da falha: regravar esse progresso evita
    # reimprimir tudo quando a impressora voltar.
    Registrar "  NF $($n.number): etiqueta FALHOU no volume $($jaFeitas+$feitas+1) - $($_.Exception.Message)"
    return $feitas
  }
}

# O link do Drive é de visualização; para baixar o arquivo é outro endereço.
function LinkDeDownload($url) {
  if ($url -match "/file/d/([^/]+)") { return "https://drive.google.com/uc?export=download&id=$($Matches[1])" }
  if ($url -match "[?&]id=([^&]+)")  { return "https://drive.google.com/uc?export=download&id=$($Matches[1])" }
  return $url
}

# ─────────────────────────── INÍCIO ───────────────────────────
# Reconhece a chave pelo formato (JWT começa com "eyJ") em vez de comparar com o
# texto do placeholder: quem cola a chave com "substituir tudo" trocaria as duas
# ocorrências e desarmaria a checagem sem perceber.
if ($SUPABASE_KEY -notlike "eyJ*") {
  Registrar "ERRO: SUPABASE_KEY nao preenchida (deve comecar com 'eyJ'). Edite o arquivo antes de rodar."
  exit 1
}
if (-not $Simular -and -not (Test-Path $SUMATRA)) {
  Registrar "ERRO: SumatraPDF.exe nao encontrado em $PASTA. Veja as instrucoes no topo do arquivo."
  exit 1
}
# Nome de impressora errado faria o SumatraPDF falhar sem dizer o porque.
if (-not $Simular -and $IMPRESSORA) {
  $existe = Get-Printer -Name $IMPRESSORA -ErrorAction SilentlyContinue
  if (-not $existe) {
    Registrar "ERRO: impressora '$IMPRESSORA' nao encontrada neste PC."
    Registrar "       Instaladas: $((Get-Printer | Select-Object -ExpandProperty Name) -join ' | ')"
    exit 1
  }
}
# Trava contra execucoes sobrepostas. Rodando a cada 1 minuto, um ciclo que
# demore mais que isso (varias notas para baixar e imprimir) seria atropelado
# pelo seguinte, e a mesma nota sairia duas vezes na bandeja.
$trava = New-Object System.Threading.Mutex($false, "Global\EntregaCertaImpressaoDANFE")
$assumiu = $false
try {
  $assumiu = $trava.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  # Ciclo anterior morreu sem liberar (PC desligado no meio). A trava e nossa.
  $assumiu = $true
}
if (-not $assumiu) { exit 0 }   # ja tem um ciclo rodando: sai quieto

# Cinto de seguranca: se este ciclo passar do prazo, ele se mata. Sem isto, uma
# rodada travada segura o mutex para sempre e a impressao para em silencio —
# a tarefa agendada nao tem limite de tempo proprio (padrao do schtasks e 72h).
$vigia = Start-Job -ArgumentList $PID, $PRAZO_MAXIMO_SEG -ScriptBlock {
  param($alvo, $prazo)
  Start-Sleep -Seconds $prazo
  Stop-Process -Id $alvo -Force -ErrorAction SilentlyContinue
}

try {

New-Item -ItemType Directory -Force -Path $TEMP | Out-Null
if (-not (Test-Path $ARQ_IMPRESSAS)) { New-Item -ItemType File -Path $ARQ_IMPRESSAS | Out-Null }
if (-not (Test-Path $ARQ_ETIQUETAS)) { New-Item -ItemType File -Path $ARQ_ETIQUETAS | Out-Null }

$jaImpressas = @{}
Get-Content $ARQ_IMPRESSAS | ForEach-Object { if ($_ -ne "") { $jaImpressas[$_] = $true } }

# Etiquetas guardam PROGRESSO: "id|jaSairam|total".
#
# Precisa dos dois números. Só "jaSairam" não diz quando parar — e o total vem do
# ERP, que não queremos perguntar eternamente. Com total gravado:
#   jaSairam >= total  -> concluída, nunca mais pergunta
#   total = 0          -> nota que não leva etiqueta (SEM_CARGA ou zero volumes)
#
# Uma nota de 143 volumes não cabe num ciclo; sem esse controle o ciclo seguinte
# recomeçaria do volume 1, duplicando tudo o que já tinha sido colado.
#
# Formatos antigos ("id" ou "id|n") contam como concluídos, para não reimprimir
# o que saiu antes desta mudança.
$progresso = @{}
Get-Content $ARQ_ETIQUETAS | ForEach-Object {
  if ($_ -ne "") {
    $p = $_ -split '\|'
    if ($p.Count -ge 3)    { $progresso[$p[0]] = @{ feitas = [int]$p[1]; total = [int]$p[2] } }
    elseif ($p.Count -eq 2){ $progresso[$p[0]] = @{ feitas = [int]$p[1]; total = [int]$p[1] } }
    else                   { $progresso[$p[0]] = @{ feitas = 1;          total = 1 } }
  }
}

# Regrava o arquivo inteiro a partir da tabela em memória: como a mesma nota pode
# ser atualizada várias vezes num ciclo, acrescentar linha criaria duplicatas.
function GravarProgressoEtiquetas {
  $linhas = $progresso.Keys | ForEach-Object { "$_|$($progresso[$_].feitas)|$($progresso[$_].total)" }
  Set-Content -Path $ARQ_ETIQUETAS -Value $linhas -Encoding utf8
}

function EtiquetaConcluida($id) {
  if (-not $progresso.ContainsKey($id)) { return $false }   # nunca perguntamos ainda
  return ($progresso[$id].feitas -ge $progresso[$id].total)
}

# ── Busca as notas candidatas ──
$desde = (Get-Date).ToUniversalTime().AddHours(-$MAX_HORAS).ToString("yyyy-MM-ddTHH:mm:ss")
# NAO filtrar por status. Uma nota pode ser atribuida, entrar em rota ou ate ser
# entregue poucos minutos depois de chegar — e se isso acontecer antes do agente
# passar, filtrar por PENDING a esconderia para sempre. Aconteceu em 13/08 com as
# NF 6864 e 6865 (entregues 6 e 25 min apos entrarem, nunca impressas).
# Quem evita imprimir nota velha e a janela de $MAX_HORAS; quem evita repetir e
# o arquivo impressas.txt. Status nao tem nada a ver com precisar de papel.
# Lê da VIEW etiqueta_expedicao, não de invoices: ela já resolve carga,
# pré-fatura, referência e volumes, venham de onde vierem. Quando a consulta
# automática ao ERP existir, muda a view e este script continua igual.
$filtro = "select=id,number,series,access_key,pdf_url,customer_name,customer_address,customer_zip,created_at,vendedor,referencia,end_logradouro,end_bairro,end_municipio,end_uf,carga,prefatura,volumes" +
          "&created_at=gte.$desde" +
          "&pdf_url=not.is.null" +
          "&deleted_at=is.null" +
          "&order=created_at.asc" +
          "&limit=$MAX_POR_CICLO"

try {
  $json  = BuscarComPrazo "$SUPABASE_URL/rest/v1/etiqueta_expedicao?$filtro" @{
    apikey        = $SUPABASE_KEY
    Authorization = "Bearer $SUPABASE_KEY"
  } 25
  $notas = $json | ConvertFrom-Json
} catch {
  Registrar "ERRO ao consultar o Supabase: $($_.Exception.Message)"
  exit 1
}

# Falta o DANFE, OU a etiqueta ainda não foi concluída. Quantas etiquetas a nota
# leva quem diz é o ERP, consultado adiante — aqui só descartamos o que já acabou.
$novas = @($notas | Where-Object {
  (-not $jaImpressas.ContainsKey($_.id)) -or
  ($IMPRIMIR_ETIQUETA -and -not (EtiquetaConcluida $_.id))
})
if ($novas.Count -eq 0) { BaterPonto; exit 0 }   # nada novo: sai quieto, mas vivo

Registrar "$($novas.Count) nota(s) nova(s) para imprimir"

$orcamentoEtiquetas = $MAX_ETIQUETAS_POR_CICLO

foreach ($nota in $novas) {

  # ── Etiqueta primeiro: é texto puro pela rede, rápido e sem download. Se ela
  # falhar, o DANFE ainda sai; e como cada um tem sua própria memória, o que
  # falhou repete sozinho no ciclo seguinte sem duplicar o outro.
  if ($IMPRIMIR_ETIQUETA -and -not (EtiquetaConcluida $nota.id)) {
    $feitas = if ($progresso.ContainsKey($nota.id)) { $progresso[$nota.id].feitas } else { 0 }

    # Nota de outro emitente: não leva etiqueta da ELLO, e consultar a carga dela
    # no ERP da ELLO devolveria dado de outra nota (os números se repetem entre
    # as empresas). Marca como encerrada para não perguntar de novo.
    $cnpjEmitente = if ($nota.access_key -and $nota.access_key.Length -ge 20) { $nota.access_key.Substring(6,14) } else { '' }
    if ($cnpjEmitente -ne $CNPJ_ELLO) {
      $progresso[$nota.id] = @{ feitas = 0; total = 0 }
      GravarProgressoEtiquetas
      Registrar "  NF $($nota.number): emitente $cnpjEmitente nao e a ELLO - sem etiqueta"
      $erp = [pscustomobject]@{ situacao='IGNORADA' }
    } else {
      # O ERP é a autoridade sobre carga, pré-fatura, referência e nº de volumes.
      $erp = ConsultarCargaERP $nota.number
    }
    switch ($erp.situacao) {
      'SEM_CARGA' {
        # Definitivo: a nota existe mas não pertence a carga nenhuma, e vem com
        # volumes 0 — o ERP não imprime etiqueta nesse caso, nós também não.
        # Grava total 0 para nunca mais perguntar por ela.
        $progresso[$nota.id] = @{ feitas = 0; total = 0 }
        GravarProgressoEtiquetas
        Registrar "  NF $($nota.number): sem carga no ERP - nao leva etiqueta"
      }
      'NAO_ENCONTRADA' {
        # Transitório: o XML chegou aqui antes de a nota aparecer no ERP.
        Registrar "  NF $($nota.number): ainda nao existe no ERP - tenta no proximo ciclo"
      }
      'IGNORADA' { }   # já tratada acima
      'OK' {
        # Existe nota COM carga e com zero volumes (medido: 6869 e 6876, carga
        # 2780 e 2779, volumes 0). O ERP não imprime etiqueta nessas. Sem encerrar
        # aqui, ela nunca completaria e o agente consultaria o ERP para sempre,
        # a cada minuto.
        if ([int]$erp.volumes -le 0) {
          $progresso[$nota.id] = @{ feitas = 0; total = 0 }
          GravarProgressoEtiquetas
          Registrar "  NF $($nota.number): carga $($erp.carga) mas zero volumes - nao leva etiqueta"
          break
        }
        # Campos do ERP mandam sobre os do banco.
        $nota | Add-Member -NotePropertyName carga      -NotePropertyValue $erp.carga      -Force
        $nota | Add-Member -NotePropertyName prefatura  -NotePropertyValue $erp.prefatura  -Force
        $nota | Add-Member -NotePropertyName volumes    -NotePropertyValue $erp.volumes    -Force
        if ($erp.referencia -and $erp.referencia.Trim()) {
          $nota | Add-Member -NotePropertyName referencia -NotePropertyValue $erp.referencia -Force
        }
        if ($Simular) {
          Registrar "  [SIMULACAO] NF $($nota.number): carga $($erp.carga)/$($erp.prefatura), $($erp.volumes) volume(s), $feitas ja feita(s)"
        } elseif ($orcamentoEtiquetas -gt 0) {
          $saiu = ImprimirEtiquetas $nota $feitas $orcamentoEtiquetas
          if ($saiu -gt 0) {
            $progresso[$nota.id] = @{ feitas = $feitas + $saiu; total = [int]$erp.volumes }
            $orcamentoEtiquetas -= $saiu
            GravarProgressoEtiquetas
          }
        }
      }
      default {
        # ERRO de rede ou serviço fora. Transitório: não marca nada e tenta depois.
        Registrar "  NF $($nota.number): ERP nao respondeu - etiqueta adiada"
      }
    }
  }

  # ── DANFE ──
  if ($jaImpressas.ContainsKey($nota.id)) { continue }   # já saiu; só faltava a etiqueta

  $destino = Join-Path $TEMP "DANFE-$($nota.access_key).pdf"
  try {
    BaixarComPrazo (LinkDeDownload $nota.pdf_url) $destino 45

    # Drive as vezes devolve uma pagina HTML no lugar do arquivo (permissao,
    # aviso de virus). Imprimir isso gastaria papel com lixo.
    $inicio = [System.IO.File]::ReadAllBytes($destino)[0..3]
    if (-not ($inicio[0] -eq 0x25 -and $inicio[1] -eq 0x50)) {   # "%P" de %PDF
      Registrar "  NF $($nota.number): download nao veio como PDF - sera tentado no proximo ciclo"
      Remove-Item $destino -Force -ErrorAction SilentlyContinue
      continue
    }

    if ($Simular) {
      Registrar "  [SIMULACAO] NF $($nota.number) - $($nota.customer_name)"
    } else {
      $argsImpressao = if ($IMPRESSORA) {
        @("-print-to", "`"$IMPRESSORA`"", "-silent", "`"$destino`"")
      } else {
        @("-print-to-default", "-silent", "`"$destino`"")
      }
      $p = Start-Process -FilePath $SUMATRA -ArgumentList $argsImpressao -PassThru
      if (-not $p.WaitForExit($TIMEOUT_IMPRESSAO_S * 1000)) {
        try { $p.Kill() } catch {}
        # Impressora provavelmente offline. Nao adianta tentar as proximas agora:
        # aborta o ciclo e deixa tudo para a proxima rodada, com a nota nao marcada.
        Registrar "  NF $($nota.number): impressora nao respondeu em $TIMEOUT_IMPRESSAO_S s - ciclo abortado"
        break
      }
      if ($p.ExitCode -ne 0) { throw "SumatraPDF retornou codigo $($p.ExitCode)" }
      Registrar "  NF $($nota.number) impressa - $($nota.customer_name)"
    }

    # So marca como impressa depois que deu certo: falha volta no proximo ciclo.
    if (-not $Simular) { Add-Content -Path $ARQ_IMPRESSAS -Value $nota.id -Encoding utf8 }

  } catch {
    Registrar "  NF $($nota.number): FALHOU - $($_.Exception.Message)"
  } finally {
    Remove-Item $destino -Force -ErrorAction SilentlyContinue
  }
}

BaterPonto   # ciclo completo: o agente esta vivo

} finally {
  # Libera a trava mesmo se algo acima falhar ou chamar exit.
  if ($vigia) { Stop-Job $vigia -ErrorAction SilentlyContinue; Remove-Job $vigia -Force -ErrorAction SilentlyContinue }
  try { $trava.ReleaseMutex() } catch {}
  $trava.Dispose()
}

# ─────────────────────────── AGENDAR NO WINDOWS ───────────────────────────
# Abra o "Agendador de Tarefas" e crie uma tarefa basica:
#   Nome      : EntregaCerta - Imprimir DANFE
#   Disparador: Ao fazer logon
#   Ação      : Iniciar um programa
#     Programa  : powershell.exe
#     Argumentos: -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\caminho\imprimir-danfe.ps1"
#
# Depois de criar, abra as Propriedades da tarefa → aba Disparadores → Editar →
# marque "Repetir a cada:" e DIGITE "1 minuto" (a lista sugere 5 minutos, mas o
# campo aceita texto), com "Duração: Indefinidamente".
#
# Ainda em Propriedades → aba Configurações, deixe marcado
# "Não iniciar uma nova instância" em "Se a tarefa já estiver em execução".
#
# Para conferir o que aconteceu, abra o arquivo impressao.log ao lado do script.
