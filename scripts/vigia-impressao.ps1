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

# ── Vigilância da impressora de etiqueta ──
# O ponto batido pelo agente NÃO cobre a etiqueta: o ciclo termina bem, o DANFE
# sai, e a térmica pode estar fora do ar sem que nada apareça. Ou seja, a falha
# mais provável da etiqueta é justamente invisível para a checagem de cima.
$ARQ_AGENTE     = Join-Path $PASTA "imprimir-danfe.ps1"
$ARQ_LOG_IMPR   = Join-Path $PASTA "impressao.log"
$ESTADO_ETIQ    = Join-Path $PASTA ".vigia-etiqueta"
$IP_ETIQUETA    = '10.9.74.176'
$PORTA_ETIQUETA = 9100
# Tolerância curta: a impressora responde em milissegundos quando está de pé.
$PRAZO_ETIQ_MS  = 4000

# ── Vigilância da FILA ──
# Bater ponto prova que o agente está VIVO, não que a fila está ANDANDO. São
# coisas diferentes, e confundi-las custou caro: em 27/08 a impressão parou às
# 14h40 com o agente perfeitamente saudável, batendo ponto a cada minuto. A
# consulta dele tinha teto de 30 e ordem crescente, então quando a janela passou
# de 30 notas ele passou a receber só as antigas, já impressas, e concluía "zero
# notas novas". Nove notas ficaram presas por duas horas. O vigia não tinha como
# ver — e o problema chegou por telefone.
$ARQ_IMPRESSAS  = Join-Path $PASTA "impressas.txt"
$ESTADO_FILA    = Join-Path $PASTA ".vigia-fila"
# Quanto tempo uma nota pode ficar sem sair antes de virar alarme. O agente roda
# a cada minuto e imprime em segundos; a folga cobre os atrasos legítimos (nota
# que ainda não existe no ERP, PDF que falhou o download, fila acima do teto do
# ciclo). Bem acima do normal e bem abaixo de "alguém liga reclamando".
$MIN_FILA_PARADA = 15
$PRAZO_HTTP_MS   = 10000

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

# ─────────────────── impressora de etiqueta ───────────────────
# Feito ANTES de sair pelo caminho feliz do agente: o ciclo pode estar perfeito e
# a térmica caída, que é exatamente a falha que ninguém vê.
function VigiarEtiqueta {
  # Só vigia se a etiqueta estiver ligada no agente. Enquanto estiver desligada,
  # a térmica fora do ar não é problema nenhum.
  if (-not (Test-Path $ARQ_AGENTE)) { return }
  $ligada = (Select-String -Path $ARQ_AGENTE -Pattern '^\$IMPRIMIR_ETIQUETA\s*=\s*\$true' -Quiet)
  if (-not $ligada) { return }

  # WaitOne devolve $true quando a tentativa TERMINA — inclusive terminando em
  # recusa. Só devolve $false no estouro de prazo. Sem o EndConnect/Connected
  # abaixo, uma conexão recusada na hora era lida como "impressora viva", e o
  # vigia anunciava que ela tinha voltado no ciclo seguinte à queda.
  $viva = $false
  try {
    $cli = New-Object System.Net.Sockets.TcpClient
    $ar  = $cli.BeginConnect($IP_ETIQUETA, $PORTA_ETIQUETA, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne($PRAZO_ETIQ_MS)) {
      try { $cli.EndConnect($ar); $viva = $cli.Connected } catch { $viva = $false }
    }
    $cli.Close()
  } catch { $viva = $false }

  # Falhas registradas pelo agente nos últimos minutos. A sondagem acima pega a
  # impressora desligada; isto pega a que aceita conexão mas recusa o trabalho.
  $falhasRecentes = 0
  if (Test-Path $ARQ_LOG_IMPR) {
    $corte = (Get-Date).AddMinutes(-15)
    Get-Content $ARQ_LOG_IMPR -Tail 60 | Where-Object { $_ -match 'etiqueta FALHOU' } | ForEach-Object {
      if ($_ -match '^(\d{2}/\d{2})\s+(\d{2}:\d{2}:\d{2})') {
        $q = try { [datetime]::ParseExact("$($Matches[1])/$((Get-Date).Year) $($Matches[2])",'dd/MM/yyyy HH:mm:ss',$null) } catch { $null }
        if ($q -and $q -ge $corte) { $falhasRecentes++ }
      }
    }
  }

  $jaAvisouEtiq = if (Test-Path $ESTADO_ETIQ) { (Get-Content $ESTADO_ETIQ -Raw).Trim() } else { '' }

  if ($viva -and $falhasRecentes -eq 0) {
    if ($jaAvisouEtiq) {
      Anotar "OK - impressora de etiqueta voltou"
      Remove-Item $ESTADO_ETIQ -Force -ErrorAction SilentlyContinue
      Avisar 'EntregaCerta - etiquetas voltaram' `
        "A impressora de etiqueta voltou a funcionar. As etiquetas que faltaram estao saindo sozinhas."
    }
    return
  }

  # Desde quando está com problema. Guardado no arquivo de estado para que o
  # aviso possa subir de tom se demorar, sem depender de o vigia ficar rodando.
  $desde = $null
  if ($jaAvisouEtiq -match '^\d{4}-\d{2}-\d{2}') {
    $desde = try { [datetime]::Parse($jaAvisouEtiq) } catch { $null }
  }
  $primeiraVez = ($null -eq $desde)
  if ($primeiraVez) { $desde = Get-Date }
  $paradaMin = [int]((Get-Date) - $desde).TotalMinutes

  # Linguagem de quem trabalha no galpão, não de quem escreveu o script: dizer
  # "nao responde em 10.9.74.176" fez o aviso ser visto e não compreendido.
  # O texto precisa responder três coisas: o que parou, o que fazer, e se perde
  # trabalho.
  $oQueHouve = if (-not $viva) {
    "A impressora de etiqueta (a termica do galpao) parou de responder."
  } else {
    "A impressora de etiqueta recusou $falhasRecentes impressao(oes) nos ultimos 15 minutos."
  }
  $texto = @"
$oQueHouve

O QUE ESTA ACONTECENDO
As notas continuam saindo normalmente na impressora de nota.
Mas as caixas estao sendo despachadas SEM ETIQUETA.

O QUE FAZER
1. Veja se ela esta ligada
2. Veja se tem etiqueta na bobina
3. Veja se o cabo de rede esta conectado

NAO SE PERDE NADA
Assim que ela voltar, as etiquetas que faltaram saem sozinhas,
inclusive das notas que ja passaram.
"@

  if ($primeiraVez) {
    Anotar "ALERTA - impressora de etiqueta parada ($(if(-not $viva){'sem resposta na rede'}else{"$falhasRecentes falha(s)"}))"
    Set-Content $ESTADO_ETIQ -Value (Get-Date).ToString('s') -Encoding utf8
    Avisar 'EntregaCerta - etiquetas nao estao saindo' $texto
    return
  }

  # Já avisou antes. Se está parada há muito tempo, o balão discreto claramente
  # não resolveu — sobe para a janela que fica na tela (com prazo, ver acima).
  if ($paradaMin -ge $MIN_PARA_INSISTIR -and $jaAvisouEtiq -notmatch 'insistiu') {
    Anotar "ALERTA GRAVE - impressora de etiqueta parada ha $paradaMin min"
    Set-Content $ESTADO_ETIQ -Value "$($desde.ToString('s')) insistiu" -Encoding utf8
    Insistir "$texto`n(Parada ha $paradaMin minutos. Esta janela fecha sozinha em 5 minutos.)"
  }
}
VigiarEtiqueta

# ─────────────────────── fila de impressão ───────────────────────
# Pergunta ao Supabase quais notas deveriam ter saído e confere contra a memória
# do agente. É a única checagem que enxerga "agente vivo, fila parada".
function VigiarFila {
  if (-not (Test-Path $ARQ_AGENTE)) { return }

  # URL, chave e janela saem do PRÓPRIO agente. Duplicar esses valores aqui
  # criaria dois lugares para manter iguais, e um dia eles divergiriam calados.
  $linhasAgente = Get-Content $ARQ_AGENTE -ErrorAction SilentlyContinue
  if (-not $linhasAgente) { return }
  function ValorDe($padrao) {
    $l = $linhasAgente | Where-Object { $_ -match $padrao } | Select-Object -First 1
    if (-not $l) { return $null }
    $m = [regex]::Match($l, '"([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($l, '=\s*(\d+)')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
  }
  $url      = ValorDe '^\$SUPABASE_URL\s*='
  $chave    = ValorDe '^\$SUPABASE_KEY\s*='
  $maxHoras = ValorDe '^\$MAX_HORAS\s*='
  if (-not $url -or -not $chave -or $chave -notlike 'eyJ*') { return }
  if (-not $maxHoras) { $maxHoras = 12 }

  # Mesma janela do agente: nota mais velha que isso ele abandona de propósito
  # (protege contra despejar dias acumulados ao ligar o PC). Alarmar por ela
  # seria alarme eterno.
  $ate   = (Get-Date).ToUniversalTime().AddMinutes(-$MIN_FILA_PARADA).ToString('yyyy-MM-ddTHH:mm:ss')
  $desde = (Get-Date).ToUniversalTime().AddHours(-[int]$maxHoras).ToString('yyyy-MM-ddTHH:mm:ss')

  $filtro = 'select=id,number,created_at' +
            "&created_at=gte.$desde" +
            "&created_at=lte.$ate" +
            '&pdf_url=not.is.null' +
            '&deleted_at=is.null' +
            '&order=created_at.asc&limit=500'

  # Se o Supabase não responder, não dá para concluir nada sobre a fila — e a
  # rede caída já tem outro sintoma. Sai calado em vez de inventar alarme.
  $notas = $null
  try {
    $req = [System.Net.HttpWebRequest]::Create("$url/rest/v1/etiqueta_expedicao?$filtro")
    $req.Method = 'GET'
    $req.Timeout = $PRAZO_HTTP_MS
    $req.ReadWriteTimeout = $PRAZO_HTTP_MS
    $req.Headers.Add('apikey', $chave)
    $req.Headers.Add('Authorization', "Bearer $chave")
    $resp = $req.GetResponse()
    try {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream())
      $notas = $sr.ReadToEnd() | ConvertFrom-Json
    } finally { $resp.Close() }
  } catch { return }
  if ($null -eq $notas) { return }

  # Lê impressas.txt PERMITINDO escrita simultânea. Com o compartilhamento
  # padrão, esta leitura travaria o Add-Content do agente; a nota não seria
  # registrada e sairia de novo no ciclo seguinte — papel duplicado causado pelo
  # próprio vigia. Falhar a leitura aqui é inofensivo: só pula a checagem.
  $impressas = @{}
  if (Test-Path $ARQ_IMPRESSAS) {
    try {
      $fs = [System.IO.File]::Open($ARQ_IMPRESSAS, 'Open', 'Read', 'ReadWrite')
      try {
        $sr = New-Object IO.StreamReader($fs)
        while ($null -ne ($l = $sr.ReadLine())) {
          if ($l.Trim()) { $impressas[$l.Trim()] = $true }
        }
      } finally { $fs.Close() }
    } catch { return }
  }

  $presas = @(@($notas) | Where-Object { -not $impressas.ContainsKey($_.id) })
  $jaAvisouFila = if (Test-Path $ESTADO_FILA) { (Get-Content $ESTADO_FILA -Raw).Trim() } else { '' }

  if ($presas.Count -eq 0) {
    if ($jaAvisouFila) {
      Anotar "OK - fila de impressao normalizada"
      Remove-Item $ESTADO_FILA -Force -ErrorAction SilentlyContinue
      Avisar 'EntregaCerta - impressao normalizada' `
        "As notas atrasadas ja sairam. A impressao voltou ao normal."
    }
    return
  }

  $maisVelha = ($presas | Select-Object -First 1)
  $atrasoMin = [int]((Get-Date) - [datetime]::Parse($maisVelha.created_at).ToLocalTime()).TotalMinutes
  $numeros = ($presas | Select-Object -First 6 | ForEach-Object { $_.number }) -join ', '
  if ($presas.Count -gt 6) { $numeros += ", ..." }

  $texto = @"
Existem $($presas.Count) nota(s) que chegaram e NAO foram impressas.
A mais antiga esta esperando ha $atrasoMin minutos.

NOTAS: $numeros

O QUE ESTA ACONTECENDO
O agente esta rodando normalmente, mas a fila nao esta andando.
O papel dessas notas nao saiu na impressora.

O QUE FAZER
1. Abra C:\EntregaCerta e rode '2-IMPRIMIR agora.bat'
2. Se as notas continuarem sem sair, avise o suporte

NAO SE PERDE NADA
As notas ficam guardadas e saem assim que a impressao voltar.
"@

  if (-not $jaAvisouFila) {
    Anotar "ALERTA - $($presas.Count) nota(s) sem imprimir (mais antiga ha $atrasoMin min): $numeros"
    Set-Content $ESTADO_FILA -Value (Get-Date).ToString('s') -Encoding utf8
    Avisar 'EntregaCerta - notas nao estao saindo' $texto
    return
  }

  # Já avisou e continua parada: sobe para a janela na tela, uma única vez.
  $desdeAviso = try { [datetime]::Parse(($jaAvisouFila -replace ' insistiu$', '')) } catch { $null }
  $paradaMin = if ($desdeAviso) { [int]((Get-Date) - $desdeAviso).TotalMinutes } else { 0 }
  if ($paradaMin -ge $MIN_PARA_INSISTIR -and $jaAvisouFila -notmatch 'insistiu') {
    Anotar "ALERTA GRAVE - fila parada ha $paradaMin min, $($presas.Count) nota(s)"
    Set-Content $ESTADO_FILA -Value "$($desdeAviso.ToString('s')) insistiu" -Encoding utf8
    Insistir "$texto`n(Esta janela fecha sozinha em 5 minutos.)"
  }
}

# Só faz sentido perguntar da fila quando o agente está vivo. Se ele estiver
# travado, o alerta lá embaixo já cobre o caso, com instrução melhor — dois
# alarmes para o mesmo problema ensinam a ignorar os dois.
if ($paradoMin -lt $LIMITE_MIN) { VigiarFila }

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
