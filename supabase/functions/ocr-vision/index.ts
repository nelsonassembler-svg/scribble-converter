import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const contentType = req.headers.get('content-type') || ''

    let imageBase64 = ''
    let mimeType    = 'image/jpeg'
    let language    = 'pt'
    let translate   = false

    if (contentType.includes('multipart/form-data')) {
      const form  = await req.formData()
      const file  = form.get('audio') as File ?? form.get('image') as File

      if (!file) throw new Error('Nenhum arquivo recebido')

      language  = (form.get('language') as string) || 'pt'
      translate = (form.get('translate') as string) === 'true'
      mimeType  = file.type || 'image/jpeg'

      // Converte para base64
      const buf  = await file.arrayBuffer()
      const arr  = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
      imageBase64 = btoa(binary)

    } else {
      // JSON fallback
      const body  = await req.json()
      imageBase64 = body.image
      language    = body.language || 'pt'
      translate   = body.translate || false
      mimeType    = body.mimeType || 'image/jpeg'
    }

    if (!imageBase64) throw new Error('Imagem inválida ou vazia')

    // Monta o prompt
    const langMap: Record<string, string> = {
      pt: 'português', en: 'inglês', es: 'espanhol',
      fr: 'francês',   de: 'alemão', it: 'italiano', ja: 'japonês'
    }
    const srcLang = langMap[language] || language

    const prompt = translate
      ? `Você é um especialista em leitura de caligrafia manuscrita e tradução.
Analise esta imagem e:
1. Transcreva TODO o texto visível (manuscrito, impresso, anotações)
2. Traduza para português do Brasil

Responda neste formato:
TRANSCRIÇÃO:
[texto original]

TRADUÇÃO EM PORTUGUÊS:
[texto traduzido]`
      : `Você é um especialista em leitura de caligrafia manuscrita em ${srcLang}.
Transcreva TODO o texto visível nesta imagem com máxima fidelidade.
- Preserve parágrafos, tópicos e estrutura original
- Para palavras ilegíveis use [?]
- Responda APENAS com o texto transcrito, sem comentários adicionais`

    // Chama GPT-4o Vision
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } }
          ]
        }]
      })
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      console.error('OpenAI error:', resp.status, errBody)
      throw new Error(`OpenAI ${resp.status}: ${errBody.slice(0, 200)}`)
    }

    const result = await resp.json()
    const text   = result.choices?.[0]?.message?.content?.trim() || ''

    return new Response(JSON.stringify({ text }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Edge Function error:', err)
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
