import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio') as File
    const language  = (formData.get('language') as string) || 'pt'
    const translate = (formData.get('translate') as string) === 'true'

    if (!audioFile) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo de áudio enviado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Monta o FormData para enviar ao OpenAI
    const whisperForm = new FormData()
    whisperForm.append('file', audioFile, audioFile.name || 'audio.webm')
    whisperForm.append('model', 'whisper-1')
    whisperForm.append('language', language)
    whisperForm.append('response_format', 'text')

    // Endpoint: transcriptions (mesmo idioma) ou translations (traduz para inglês)
    const endpoint = translate
      ? 'https://api.openai.com/v1/audio/translations'
      : 'https://api.openai.com/v1/audio/transcriptions'

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: whisperForm,
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return new Response(JSON.stringify({ error: 'Erro na transcrição: ' + err }), {
        status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const text = await response.text()

    return new Response(JSON.stringify({ text: text.trim() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Erro:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
