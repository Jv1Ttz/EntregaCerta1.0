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
# Sabado saiu da lista: em 90 dias de historico, ZERO notas entraram no sabado
# ou no domingo (1.882 notas, todas de segunda a sexta). Monitorar um dia sem
# movimento so gera alarme falso.
$DIAS_UTEIS        = @('Monday','Tuesday','Wednesday','Thursday','Friday')
# Depois de tanto tempo parado, sobe de aviso discreto para janela na tela.
$MIN_PARA_INSISTIR = 30
# A janela persistente TEM que ter prazo. Com prazo 0 ela espera clique para
# sempre, o script nunca termina, e o Agendador nao inicia a proxima execucao
# enquanto a anterior estiver rodando -- ou seja, o vigia se desliga sozinho.
# Aconteceu de verdade: ficou preso de 15/08 07:04 ate 17/08 08:04, dois dias
# inteiros cego. O alarme de incendio travado pelo proprio alarme.
$SEG_JANELA_ABERTA = 300

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
  # Janela mais chamativa, para o caso de o aviso discreto ter passado batido.
  # O prazo em segundos é essencial: ela se fecha sozinha e o script segue.
  try { (New-Object -ComObject Wscript.Shell).Popup($texto, $SEG_JANELA_ABERTA, 'EntregaCerta - impressao parada', 48) | Out-Null } catch { }
}

# Desde quando esta maquina esta de pe e acordada.
#
# Nao basta olhar o boot: dormir NAO altera a hora do boot, entao depois de uma
# soneca o vigia via "PC ligado ha 3 dias" e concluia que o agente tinha morrido,
# quando na verdade a maquina inteira estava dormindo junto. Foi o que gerou o
# "parado ha 871 min" de 15/08 -- o PC dormiu sexta 16:33 e acordou sabado 07:00.
function AcordadaDesde() {
  $boot  = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  $maior = $boot

  # Duas fontes, porque nenhuma sozinha cobre todos os casos -- medido nesta
  # maquina: o Kernel-Power 107 registrou 14/08 16:33 e 12/08 17:30, enquanto os
  # despertares de 07:00 (alarme da BIOS) sairam SO no Power-Troubleshooter.
  # Olhar so o 107, como fiz na primeira versao, erraria justamente o caso do
  # 13/08 e do 15/08. Fica com a retomada mais recente das duas.
  $fontes = @(
    @{ ProviderName='Microsoft-Windows-Kernel-Power';          Id=107 },
    @{ ProviderName='Microsoft-Windows-Power-Troubleshooter';  Id=1   }
  )
  foreach ($f in $fontes) {
    try {
      $ev = Get-WinEvent -FilterHashtable @{
        LogName='System'; ProviderName=$f.ProviderName; Id=$f.Id; StartTime=$boot
      } -MaxEvents 1 -ErrorAction Stop | Select-Object -ExpandProperty TimeCreated
      if ($ev -and $ev -gt $maior) { $maior = $ev }
    } catch { }   # sem evento dessa fonte: segue para a proxima
  }
  return $maior
}

# ─────────────────────────── verificação ───────────────────────────
$agora = Get-Date
$expediente = ($DIAS_UTEIS -contains $agora.DayOfWeek.ToString()) -and
              ($agora.Hour -ge $HORA_INICIO) -and ($agora.Hour -lt $HORA_FIM)
if (-not $expediente) { exit 0 }

# Logo depois de ligar o PC, o ponto e da noite anterior por definicao — nao e
# travamento. Sem esta folga o vigia dispara todo dia as 7h, e alarme falso
# diario ensina a ignorar o alarme, que e justamente o que nao pode acontecer.
# (Aconteceu em 13/08: "parado ha 813 min" logo apos o boot.)
$acordadaHaMin = [int]((Get-Date) - (AcordadaDesde)).TotalMinutes
if ($acordadaHaMin -lt 15) { exit 0 }

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
  # Marca ANTES de exibir: avisar na tela envolve janela e espera, e se algo
  # segurar o script ali, o estado ja esta gravado e a proxima execucao nao
  # repete o alerta do zero.
  Set-Content $ARQ_ESTADO -Value 'insistiu' -Encoding utf8
  Avisar 'EntregaCerta - impressao parada' $msg
  Insistir "$msg`n`nO que fazer:`n1. Abra C:\EntregaCerta e rode '2-IMPRIMIR agora.bat'`n2. Se nao resolver, reinicie o PC`n`nNenhuma nota se perde: elas voltam a sair quando o agente normalizar.`n`n(Esta janela fecha sozinha em 5 minutos.)"
}
elseif (-not $jaAvisou) {
  Anotar "ALERTA - parado ha $paradoMin min"
  Avisar 'EntregaCerta - impressao parada' $msg
  Set-Content $ARQ_ESTADO -Value 'avisou' -Encoding utf8
}
