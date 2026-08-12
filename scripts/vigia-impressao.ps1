# EntregaCerta — vigia da impressão automática
#
# POR QUE EXISTE: quando o agente trava, ele não imprime E não reclama. Já
# aconteceu: uma rodada ficou pendurada segurando o mutex, as seguintes saíram
# em silêncio e a impressão parou por 13 minutos sem nenhum erro no log. Falha
# silenciosa é a que mais custa caro — ninguém percebe até alguém cobrar a nota.
#
# COMO FUNCIONA: o agente "bate o ponto" (grava a hora) toda vez que um ciclo
# termina bem, mesmo sem ter nota para imprimir. Este vigia só olha esse ponto.
# Ponto velho = agente morto ou travado. Ponto fresco e sem impressão = apenas
# não chegou nota nenhuma, que é o estado saudável mais comum.
#
# INSTALAÇÃO: rode uma vez o "5-ATIVAR vigia.bat" (ao lado deste arquivo).

$PASTA       = Split-Path -Parent $MyInvocation.MyCommand.Path
$ARQ_PONTO   = Join-Path $PASTA "ultima-rodada.txt"
$ARQ_ALERTAS = Join-Path $PASTA "alertas.log"
$ARQ_ESTADO  = Join-Path $PASTA ".vigia-estado"

# O agente roda a cada 1 min. Com 10 min de silêncio já há algo errado, e a
# folga evita alarme por uma rodada que demorou um pouco mais.
$LIMITE_MIN        = 10
# Só incomoda em horário de trabalho: fora disso o PC pode estar desligado de
# propósito e não há nota chegando (as notas entram entre ~8h e ~19h).
$HORA_INICIO       = 7
$HORA_FIM          = 19
$DIAS_UTEIS        = @('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
# Depois de tanto tempo parado, sobe de aviso discreto para janela na tela.
$MIN_PARA_INSISTIR = 30

function Anotar($txt) {
  $l = "{0}  {1}" -f (Get-Date -Format 'dd/MM HH:mm:ss'), $txt
  Add-Content -Path $ARQ_ALERTAS -Value $l -Encoding utf8
  Write-Host $l
}

function Avisar($titulo, $texto) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $ico = New-Object System.Windows.Forms.NotifyIcon
    $ico.Icon = [System.Drawing.SystemIcons]::Warning
    $ico.BalloonTipIcon  = 'Warning'
    $ico.BalloonTipTitle = $titulo
    $ico.BalloonTipText  = $texto
    $ico.Visible = $true
    $ico.ShowBalloonTip(20000)
    Start-Sleep -Seconds 12
    $ico.Dispose()
  } catch { }
}

function Insistir($texto) {
  # Janela que fica na tela até alguém fechar — para o caso de o aviso discreto
  # ter passado batido. Só aparece quando já faz muito tempo.
  try { (New-Object -ComObject Wscript.Shell).Popup($texto, 0, 'EntregaCerta - impressao parada', 48) | Out-Null } catch { }
}

# ─────────────────────────── verificação ───────────────────────────
$agora = Get-Date
$expediente = ($DIAS_UTEIS -contains $agora.DayOfWeek.ToString()) -and
              ($agora.Hour -ge $HORA_INICIO) -and ($agora.Hour -lt $HORA_FIM)
if (-not $expediente) { exit 0 }

if (-not (Test-Path $ARQ_PONTO)) {
  # Sem ponto nenhum: ou nunca rodou, ou é uma instalação nova. Não alarma.
  exit 0
}

$ponto = try { [datetime]::Parse((Get-Content $ARQ_PONTO -Raw).Trim()) } catch { $null }
if (-not $ponto) { exit 0 }

$paradoMin = [int]($agora - $ponto).TotalMinutes

# Estado anterior, para não repetir o mesmo alerta a cada 5 minutos.
$jaAvisou = if (Test-Path $ARQ_ESTADO) { (Get-Content $ARQ_ESTADO -Raw).Trim() } else { '' }

if ($paradoMin -lt $LIMITE_MIN) {
  if ($jaAvisou) {
    Anotar "OK - impressao voltou ao normal (ultima rodada ha $paradoMin min)"
    Remove-Item $ARQ_ESTADO -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

$msg = "O agente de impressao nao completa um ciclo ha $paradoMin minutos. " +
       "Notas que chegarem agora NAO estao sendo impressas."

if ($paradoMin -ge $MIN_PARA_INSISTIR -and $jaAvisou -ne 'insistiu') {
  Anotar "ALERTA GRAVE - parado ha $paradoMin min"
  Avisar 'EntregaCerta - impressao parada' $msg
  Insistir "$msg`n`nO que fazer:`n1. Abra C:\EntregaCerta e rode '2-IMPRIMIR agora.bat'`n2. Se nao resolver, reinicie o PC`n`nNenhuma nota se perde: elas voltam a sair quando o agente normalizar."
  Set-Content $ARQ_ESTADO -Value 'insistiu' -Encoding utf8
}
elseif (-not $jaAvisou) {
  Anotar "ALERTA - parado ha $paradoMin min"
  Avisar 'EntregaCerta - impressao parada' $msg
  Set-Content $ARQ_ESTADO -Value 'avisou' -Encoding utf8
}
