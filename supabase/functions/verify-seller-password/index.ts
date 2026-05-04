// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Responde preflight do browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ valid: false }, 405)
  }

  try {
    const { password } = await req.json()
    const stored = Deno.env.get('SELLER_PASSWORD')

    if (!stored) {
      return json({ valid: false, error: 'Senha não configurada no servidor.' }, 500)
    }

    return json({ valid: password === stored })
  } catch {
    return json({ valid: false, error: 'Requisição inválida.' }, 400)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
