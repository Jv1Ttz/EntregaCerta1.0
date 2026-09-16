# EntregaCerta - backup diario (PC do escritorio, LIC-02)
#
# POR QUE EXISTE: desde 11/09/2026 o EntregaCerta roda no servidor proprio (VPS
# Hostinger). A unica copia fora dele era o backup SEMANAL automatico da Hostinger:
# um disco perdido podia levar ate 7 dias de notas, baixas e canhotos.
#
# COMO FUNCIONA:
#   02:00  o servidor gera banco-AAAA-MM-DD.dump e guarda 7 dias
#          (/root/backups/entregacerta/backup-banco.sh, no crontab do root)
#   07:30  este script busca os backups do banco que faltam aqui (guarda 30) e as
#          fotos de canhoto novas ou alteradas, como arquivos .jpg/.png normais
#   vigia  se o ultimo backup completo tiver mais de 30 horas, avisa na tela
#
# O PC suspende ~17h e acorda sozinho as 07:00, por isso a busca e de manha e nao
# de madrugada. Se ele ficar dias desligado, a proxima rodada busca tudo o que
# faltou (o servidor guarda 7 dias).
#
# Foto que some do servidor NAO e apagada daqui: o backup existe justamente para o
# dia em que alguma coisa some por engano.
#
# Plano completo: https://claude.ai/code/artifact/3a372e11-24b8-4a26-95d1-4ff806d4c251
#
# Arquivo so com caracteres ASCII de proposito: o PowerShell 5.1 le .ps1 sem BOM
# como ANSI, e o travessao em UTF-8 vira aspas no meio de uma string.

param(
  # So para teste: baixa no maximo N fotos nesta rodada (e nao marca como completo).
  [int]$LimiteFotos = 0
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PASTA        = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKUP       = Join-Path $PASTA 'backup'
$DIR_BANCO    = Join-Path $BACKUP 'banco'
$DIR_FOTOS    = Join-Path $BACKUP 'fotos'
$ARQ_LOG      = Join-Path $BACKUP 'backup.log'
# O vigia olha este arquivo. So e gravado quando banco E fotos terminaram sem falha.
$ARQ_OK       = Join-Path $BACKUP 'ultimo-backup-ok.txt'
$CHAVE        = Join-Path $PASTA 'ssh\entregacerta_vps'
$KNOWN_HOSTS  = Join-Path $PASTA 'ssh\known_hosts'
$REMOTO       = '/root/backups/entregacerta'
$COPIAS_BANCO = 30
$BUCKET       = 'delivery-proofs'
$PRAZO_FOTO_SEG = 60

$SSH_OPCOES = @('-i', $CHAVE, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
                '-o', "UserKnownHostsFile=$KNOWN_HOSTS", '-o', 'ConnectTimeout=20',
                '-o', 'ServerAliveInterval=15')

function Registrar($texto) {
  $linha = "{0}  {1}" -f (Get-Date -Format 'dd/MM HH:mm:ss'), $texto
  Write-Host $linha
  # Mesma protecao do agente de impressao: se alguem estiver lendo o log neste
  # instante, o Add-Content falha e a linha se perderia calada.
  for ($i = 1; $i -le 3; $i++) {
    try { Add-Content -Path $ARQ_LOG -Value $linha -Encoding utf8 -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 300 }
  }
}

function LerConfig {
  $cfg = @{}
  Get-Content (Join-Path $PASTA '.local.txt') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([^#=][^=]*?)\s*=\s*(.*)$') {
      # Trim do BOM: o Bloco de Notas grava um, que grudava no nome da 1a chave.
      $cfg[$matches[1].Trim([char]0xFEFF).Trim()] = $matches[2].Trim().Trim('<>').Trim()
    }
  }
  foreach ($k in 'ssh_host', 'ssh_user', 'url', 'service') {
    if (-not $cfg[$k]) { throw "falta a linha '$k' em .local.txt" }
  }
  return $cfg
}

function Remoto($cfg, $comando) {
  $saida = & ssh.exe @SSH_OPCOES "$($cfg.ssh_user)@$($cfg.ssh_host)" $comando
  if ($LASTEXITCODE -ne 0) { throw "ssh falhou (codigo $LASTEXITCODE) em: $comando" }
  return $saida
}

# HttpWebRequest em vez de Invoke-WebRequest: no PowerShell 5.1 o -TimeoutSec e
# ignorado quando a conexao trava no meio (ja pendurou o agente de impressao por 12 min).
function BaixarComPrazo($url, $destino, $cabecalhos, $segundos) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = 'GET'
  $req.Timeout = $segundos * 1000
  $req.ReadWriteTimeout = $segundos * 1000
  foreach ($k in $cabecalhos.Keys) { $req.Headers.Add($k, $cabecalhos[$k]) }
  $resp = $req.GetResponse()
  try {
    $fs = [IO.File]::Create($destino)
    try { $resp.GetResponseStream().CopyTo($fs) } finally { $fs.Close() }
  } finally { $resp.Close() }
}

function BuscarBanco($cfg) {
  $servidor = @{}
  foreach ($l in (Remoto $cfg "$REMOTO/listar.sh banco")) {
    $nome, $tam = "$l" -split '\|', 2
    if ($nome -match '^banco-\d{4}-\d{2}-\d{2}\.dump$') { $servidor[$nome] = [long]$tam }
  }
  if ($servidor.Count -eq 0) { throw 'o servidor nao tem nenhum backup do banco' }

  $baixados = 0
  foreach ($nome in ($servidor.Keys | Sort-Object)) {
    $destino = Join-Path $DIR_BANCO $nome
    if ((Test-Path $destino) -and (Get-Item $destino).Length -eq $servidor[$nome]) { continue }
    # Baixa para .parcial e so renomeia com o tamanho conferido: um backup cortado
    # no meio nunca fica com cara de backup bom.
    $parcial = "$destino.parcial"
    & scp.exe @SSH_OPCOES "$($cfg.ssh_user)@$($cfg.ssh_host):$REMOTO/$nome" $parcial
    if ($LASTEXITCODE -ne 0) { throw "scp falhou ao baixar $nome" }
    if ((Get-Item $parcial).Length -ne $servidor[$nome]) {
      Remove-Item $parcial -Force
      throw "$nome chegou com tamanho diferente do servidor"
    }
    Move-Item $parcial $destino -Force
    $baixados++
    Registrar ("  banco: baixado {0} ({1:N1} MB)" -f $nome, ($servidor[$nome] / 1MB))
  }

  Get-ChildItem $DIR_BANCO -Filter 'banco-*.dump' | Sort-Object Name -Descending |
    Select-Object -Skip $COPIAS_BANCO | ForEach-Object {
      Remove-Item $_.FullName -Force
      Registrar "  banco: removido $($_.Name) (guarda so os $COPIAS_BANCO mais recentes)"
    }

  # Baixar tudo certinho nao basta: se o agendamento do servidor parou, o "mais novo"
  # e de dias atras e o backup estaria velho sem ninguem perceber.
  $maisNovo = $servidor.Keys | Sort-Object | Select-Object -Last 1
  $dataNovo = [datetime]::ParseExact($maisNovo.Substring(6, 10), 'yyyy-MM-dd', $null)
  $emDia = $dataNovo -ge (Get-Date).Date.AddDays(-1)
  return @{ baixados = $baixados; maisNovo = $maisNovo; emDia = $emDia }
}

function BuscarFotos($cfg) {
  $cab = @{ apikey = $cfg.service; Authorization = "Bearer $($cfg.service)" }
  $base = $cfg.url.TrimEnd('/')
  $r = @{ total = 0; novas = 0; falhas = 0; pendentes = 0; bytes = 0 }

  foreach ($l in (Remoto $cfg "$REMOTO/listar.sh fotos")) {
    $nome, $tam = "$l" -split '\|', 2
    if (-not $nome) { continue }
    # O nome vira caminho no disco: so aceita o formato conhecido (<id>/foto.jpg)
    # e recusa '..', para um nome estranho nunca escrever fora da pasta do backup.
    if ($nome -notmatch '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' -or $nome -match '(^|/)\.\.?(/|$)') {
      $r.falhas++
      Registrar "  fotos: nome fora do padrao, pulado: $nome"
      continue
    }
    $r.total++
    $tam = [long]$tam
    $destino = Join-Path $DIR_FOTOS ($nome -replace '/', '\')
    if ((Test-Path $destino) -and (Get-Item $destino).Length -eq $tam) { continue }
    if ($LimiteFotos -gt 0 -and $r.novas -ge $LimiteFotos) { $r.pendentes++; continue }

    $parcial = "$destino.parcial"
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
      BaixarComPrazo "$base/storage/v1/object/$BUCKET/$nome" $parcial $cab $PRAZO_FOTO_SEG
      if ($tam -gt 0 -and (Get-Item $parcial).Length -ne $tam) { throw 'chegou com tamanho diferente' }
      Move-Item $parcial $destino -Force
      $r.novas++
      $r.bytes += $tam
    } catch {
      $r.falhas++
      Remove-Item $parcial -Force -ErrorAction SilentlyContinue
      # Limita o log: com o servidor fora do ar seriam milhares de linhas iguais.
      if ($r.falhas -le 10) { Registrar "  fotos: FALHOU $nome ($($_.Exception.Message))" }
    }
  }
  return $r
}

# --- rodada ---
New-Item -ItemType Directory -Force -Path $DIR_BANCO, $DIR_FOTOS | Out-Null
$trava = New-Object System.Threading.Mutex($false, 'Global\EntregaCertaBackup')
if (-not $trava.WaitOne(0)) { Registrar 'backup: outra rodada ainda em andamento - saindo'; exit 0 }

$codigo = 0
try {
  $inicio = Get-Date
  Registrar 'backup: inicio'
  $cfg   = LerConfig
  $banco = BuscarBanco $cfg
  $fotos = BuscarFotos $cfg
  $min   = ((Get-Date) - $inicio).TotalMinutes
  $resumo = "banco mais recente {0} ({1} baixado(s)); fotos: {2} no servidor, {3} nova(s) ({4:N1} MB), {5} falha(s); {6:N1} min" -f `
    $banco.maisNovo, $banco.baixados, $fotos.total, $fotos.novas, ($fotos.bytes / 1MB), $fotos.falhas, $min

  if (-not $banco.emDia) {
    Registrar "backup: INCOMPLETO - o servidor nao gerou backup do banco desde $($banco.maisNovo); $resumo"
    $codigo = 1
  } elseif ($fotos.falhas -gt 0 -or $fotos.pendentes -gt 0) {
    Registrar "backup: INCOMPLETO - $resumo; $($fotos.pendentes) foto(s) ficaram para a proxima rodada"
    $codigo = 1
  } else {
    Set-Content -Path $ARQ_OK -Value ("{0}|{1}" -f (Get-Date -Format 'o'), $resumo) -Encoding utf8
    Registrar "backup: OK - $resumo"
  }
} catch {
  Registrar "backup: FALHOU - $($_.Exception.Message)"
  $codigo = 1
} finally {
  $trava.ReleaseMutex()
  $trava.Dispose()
}
exit $codigo
