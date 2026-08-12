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
$ARQ_IMPRESSAS = Join-Path $PASTA "impressas.txt"   # memória: o que já saiu
$ARQ_LOG       = Join-Path $PASTA "impressao.log"
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

function Registrar($texto) {
  $linha = "{0}  {1}" -f (Get-Date -Format "dd/MM HH:mm:ss"), $texto
  Write-Host $linha
  Add-Content -Path $ARQ_LOG -Value $linha -Encoding utf8
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

$jaImpressas = @{}
Get-Content $ARQ_IMPRESSAS | ForEach-Object { if ($_ -ne "") { $jaImpressas[$_] = $true } }

# ── Busca as notas candidatas ──
# status=PENDING: nota ja entregue nao precisa de papel.
$desde = (Get-Date).ToUniversalTime().AddHours(-$MAX_HORAS).ToString("yyyy-MM-ddTHH:mm:ss")
$filtro = "select=id,number,access_key,pdf_url,customer_name,created_at" +
          "&created_at=gte.$desde" +
          "&pdf_url=not.is.null" +
          "&status=eq.PENDING" +
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

$novas = @($notas | Where-Object { -not $jaImpressas.ContainsKey($_.id) })
if ($novas.Count -eq 0) { exit 0 }   # nada novo: sai quieto

Registrar "$($novas.Count) nota(s) nova(s) para imprimir"

foreach ($nota in $novas) {
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
