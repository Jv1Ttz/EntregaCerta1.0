// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SALVADORSAT_BASE = 'https://www16.itrack.com.br/csalvadorsat'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function normalizePlate(plate: string): string {
  return plate.replace(/[\s\-\.]/g, '').toUpperCase()
}

async function getSessionCookies(): Promise<string> {
  const body = new URLSearchParams({
    usuario: Deno.env.get('ITRACK_USER')!,
    senha: Deno.env.get('ITRACK_PASSWORD')!,
  })

  const res = await fetch(`${SALVADORSAT_BASE}/controleautenticacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  })

  const cookies = res.headers.getSetCookie?.() ?? []
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ')

  if (!cookieHeader.includes('JSESSIONID')) {
    throw new Error(`Falha na autenticação SALVADORSAT (status ${res.status})`)
  }

  return cookieHeader
}

interface VehicleData {
  plate: string
  lat: number
  lng: number
  updatedAt: string
  speedKmh: number
}

function parseMonitoringHtml(html: string): VehicleData[] {
  const vehicles: VehicleData[] = []

  // Dividir em blocos de linha <tr> que contêm um veiid
  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi
  const rows = html.match(rowRegex) ?? []

  for (const row of rows) {
    if (!row.includes('veiid=')) continue

    // Placa do veículo no popup overlib
    const plateMatch = row.match(/Plaque:\s*<\/b>([A-Z0-9\-]+)/)
    if (!plateMatch) continue
    const plate = plateMatch[1].trim()

    // Coordenadas
    const coordMatch = row.match(/Latitude \/ Longitude:\s*<\/b>([-\d.]+)\s*,\s*([-\d.]+)/)
    if (!coordMatch) continue
    const lat = parseFloat(coordMatch[1])
    const lng = parseFloat(coordMatch[2])
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue

    // Data/hora da última posição (célula da tabela dd/mm/yyyy hh:mm:ss)
    const dateMatch = row.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/)
    let updatedAt = new Date().toISOString()
    if (dateMatch) {
      // Converter de dd/mm/yyyy para ISO (servidor está em horário de Brasília UTC-3)
      const [, dd, mm, yyyy, time] = dateMatch
      updatedAt = new Date(`${yyyy}-${mm}-${dd}T${time}-03:00`).toISOString()
    }

    // Velocidade
    const speedMatch = row.match(/Speed:\s*<\/b>([\d.]+) Km\/h/)
    const speedKmh = speedMatch ? parseFloat(speedMatch[1]) : 0

    vehicles.push({ plate, lat, lng, updatedAt, speedKmh })
  }

  return vehicles
}

Deno.serve(async (_req) => {
  try {
    // 1. Autenticar via formulário e obter cookies de sessão
    const cookies = await getSessionCookies()

    // 2. Buscar dados de monitoramento (todos os rastreadores ativos)
    const monitorUrl = `${SALVADORSAT_BASE}/controleprincipalajax?d=${Date.now()}&atraso=true&ign=11&ultTrans=111&ordenarPor=2&aberturaLinks=0`
    const monitorRes = await fetch(monitorUrl, {
      headers: { Cookie: cookies },
    })
    if (!monitorRes.ok) throw new Error(`Erro ao buscar dados: HTTP ${monitorRes.status}`)

    const html = await monitorRes.text()
    const trackers = parseMonitoringHtml(html)

    if (trackers.length === 0) {
      return json({ ok: true, updated: 0, message: 'Nenhum rastreador com GPS válido encontrado' })
    }

    // 3. Buscar veículos cadastrados no EntregaCerta
    const { data: vehicles, error: vErr } = await supabase
      .from('vehicles')
      .select('id, plate')
    if (vErr) throw vErr

    // 4. Match placa SALVADORSAT → veículo EntregaCerta → atualiza last_location do veículo diretamente
    const updates: Promise<any>[] = []
    const matched: string[] = []
    const skipped: string[] = []

    for (const tracker of trackers) {
      const normalizedTrackerPlate = normalizePlate(tracker.plate)
      const vehicle = vehicles?.find(v => normalizePlate(v.plate) === normalizedTrackerPlate)

      if (!vehicle) {
        skipped.push(`${tracker.plate} (placa não cadastrada no EntregaCerta)`)
        continue
      }

      updates.push(
        supabase.from('vehicles').update({
          last_location: {
            lat: tracker.lat,
            lng: tracker.lng,
            updated_at: tracker.updatedAt,
            speed_kmh: tracker.speedKmh,
            source: 'salvadorsat',
          },
        }).eq('id', vehicle.id)
      )
      matched.push(vehicle.plate)
    }

    await Promise.all(updates)

    return json({ ok: true, updated: matched.length, matched, skipped, trackers_found: trackers.length })
  } catch (err) {
    console.error('sync-itrack-gps erro:', err)
    return json({ ok: false, error: String(err) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
