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
$ETIQUETA_LARGURA  = 480   # 60mm a 203dpi (8 pontos por mm)
$ETIQUETA_ALTURA   = 720   # 90mm

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

  $z = @('^XA', "^PW$ETIQUETA_LARGURA", "^LL$ETIQUETA_ALTURA", '^LH0,0', '^CI0')
  $y = 18
  $z += "^FO14,$y^A0N,18,18^FDREMETENTE^FS"; $y += 20
  $z += "^FO14,$y^FB452,2,0,L^A0N,20,20^FD$(LimparZPL $REMETENTE)^FS"; $y += 30
  $z += "^FO10,$y^GB460,2,2^FS"; $y += 12

  $z += "^FO14,$y^A0N,18,18^FDDESTINATARIO^FS"; $y += 20
  $z += "^FO14,$y^FB452,3,0,L^A0N,22,22^FD$(LimparZPL $n.customer_name)^FS"; $y += 78
  $z += "^FO10,$y^GB460,2,2^FS"; $y += 12

  $z += "^FO14,$y^A0N,18,18^FDENDERECO^FS"; $y += 20
  $z += "^FO14,$y^FB452,2,0,L^A0N,20,20^FD$logr^FS"; $y += 48
  if ($bairro) { $z += "^FO14,$y^A0N,20,20^FDBAIRRO: $bairro^FS"; $y += 24 }
  $z += "^FO14,$y^A0N,20,20^FDCEP: $cep^FS"; $y += 24
  $z += "^FO14,$y^A0N,20,20^FDDESTINO: $cidade^FS"
  $z += "^FO360,$y^A0N,20,20^FDUF: $uf^FS"; $y += 28
  $z += "^FO10,$y^GB460,2,2^FS"; $y += 12

  if ($ref)  { $z += "^FO14,$y^FB452,2,0,L^A0N,18,18^FDREF: $ref^FS"; $y += 42 }
  if ($vend) { $z += "^FO14,$y^A0N,18,18^FDVENDEDOR: $vend^FS"; $y += 26 }

  $yRod = $ETIQUETA_ALTURA - 132
  $z += "^FO10,$yRod^GB460,2,2^FS"
  $z += "^FO14,$($yRod+12)^A0N,20,20^FDNOTA FISCAL^FS"
  $z += "^FO14,$($yRod+34)^A0N,52,52^FD$(LimparZPL $n.number)^FS"
  $z += "^FO14,$($yRod+92)^A0N,18,18^FDSERIE: $(LimparZPL $n.series)^FS"
  $z += "^FO300,$($yRod+12)^A0N,20,20^FDVOLUME^FS"
  $z += "^FO300,$($yRod+34)^A0N,52,52^FD$vol/$totalVol^FS"
  $z += '^XZ'
  return ($z -join "`r`n")
}

# Imprime uma etiqueta por volume. Devolve $true só se TODAS saíram.
function ImprimirEtiquetas($n) {
  $total = if ($n.cargo_volume_count -and [int]$n.cargo_volume_count -gt 0) { [int]$n.cargo_volume_count } else { 1 }
  try {
    $cli = New-Object System.Net.Sockets.TcpClient
    if (-not $cli.BeginConnect($IP_ETIQUETA,$PORTA_ETIQUETA,$null,$null).AsyncWaitHandle.WaitOne(5000)) {
      throw "impressora de etiqueta nao respondeu em $IP_ETIQUETA"
    }
    $st = $cli.GetStream()
    for ($v = 1; $v -le $total; $v++) {
      $b = [Text.Encoding]::ASCII.GetBytes((MontarZPL $n $v $total))
      $st.Write($b,0,$b.Length); $st.Flush()
      Start-Sleep -Milliseconds 250
    }
    $st.Close(); $cli.Close()
    Registrar "  NF $($n.number): $total etiqueta(s)"
    return $true
  } catch {
    Registrar "  NF $($n.number): etiqueta FALHOU - $($_.Exception.Message)"
    return $false
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
$jaEtiquetadas = @{}
Get-Content $ARQ_ETIQUETAS | ForEach-Object { if ($_ -ne "") { $jaEtiquetadas[$_] = $true } }

# ── Busca as notas candidatas ──
$desde = (Get-Date).ToUniversalTime().AddHours(-$MAX_HORAS).ToString("yyyy-MM-ddTHH:mm:ss")
# NAO filtrar por status. Uma nota pode ser atribuida, entrar em rota ou ate ser
# entregue poucos minutos depois de chegar — e se isso acontecer antes do agente
# passar, filtrar por PENDING a esconderia para sempre. Aconteceu em 13/08 com as
# NF 6864 e 6865 (entregues 6 e 25 min apos entrarem, nunca impressas).
# Quem evita imprimir nota velha e a janela de $MAX_HORAS; quem evita repetir e
# o arquivo impressas.txt. Status nao tem nada a ver com precisar de papel.
$filtro = "select=id,number,series,access_key,pdf_url,customer_name,customer_address,customer_zip,created_at,vendedor,referencia,end_logradouro,end_bairro,end_municipio,end_uf,cargo_volume_count" +
          "&created_at=gte.$desde" +
          "&pdf_url=not.is.null" +
          "&deleted_at=is.null" +
          "&order=created_at.asc" +
          "&limit=$MAX_POR_CICLO"

try {
  $json  = BuscarComPrazo "$SUPABASE_URL/rest/v1/invoices?$filtro" @{
    apikey        = $SUPABASE_KEY
    Authorization = "Bearer $SUPABASE_KEY"
  } 25
  $notas = $json | ConvertFrom-Json
} catch {
  Registrar "ERRO ao consultar o Supabase: $($_.Exception.Message)"
  exit 1
}

# Falta o DANFE OU falta a etiqueta: as duas coisas são contadas separadamente.
$novas = @($notas | Where-Object {
  (-not $jaImpressas.ContainsKey($_.id)) -or
  ($IMPRIMIR_ETIQUETA -and -not $jaEtiquetadas.ContainsKey($_.id))
})
if ($novas.Count -eq 0) { BaterPonto; exit 0 }   # nada novo: sai quieto, mas vivo

Registrar "$($novas.Count) nota(s) nova(s) para imprimir"

foreach ($nota in $novas) {

  # ── Etiqueta primeiro: é texto puro pela rede, rápido e sem download. Se ela
  # falhar, o DANFE ainda sai; e como cada um tem sua própria memória, o que
  # falhou repete sozinho no ciclo seguinte sem duplicar o outro.
  if ($IMPRIMIR_ETIQUETA -and -not $jaEtiquetadas.ContainsKey($nota.id)) {
    if ($Simular) {
      $tv = if ($nota.cargo_volume_count -and [int]$nota.cargo_volume_count -gt 0) { [int]$nota.cargo_volume_count } else { 1 }
      Registrar "  [SIMULACAO] NF $($nota.number): $tv etiqueta(s)"
    } elseif (ImprimirEtiquetas $nota) {
      Add-Content -Path $ARQ_ETIQUETAS -Value $nota.id -Encoding utf8
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
