import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const formData  = await req.formData()
    const imageFile = formData.get('image') as File
    const language  = (formData.get('language') as string) || 'pt'
    const translate = (formData.get('translate') as string) === 'true'

    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'Nenhuma imagem enviada' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Converte a imagem para base64
    const arrayBuffer = await imageFile.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    const mimeType = imageFile.type || 'image/jpeg'

    // Monta o prompt conforme idioma e tradução
    const langName: Record<string, string> = {
      'pt': 'português', 'en': 'inglês', 'es': 'espanhol',
      'fr': 'francês', 'de': 'alemão', 'it': 'italiano'
    }
    const sourceLang = langName[language] || language

    let prompt = ''
    if (translate) {
      prompt = `Você é um especialista em leitura de caligrafia e tradução.
Transcreva TODO o texto manuscrito desta imagem — incluindo texto cursivo, letra de forma, anotações e qualquer texto visível.
Em seguida, traduza o texto transcrito para o português do Brasil.

Formato da resposta:
TRANSCRIÇÃO ORIGINAL:
[texto transcrito]

TRADUÇÃO EM PORTUGUÊS:
[texto traduzido]

Seja preciso, preserve a estrutura original (parágrafos, listas, tópicos).`
    } else {
      prompt = `Você é um especialista em leitura de caligrafia manuscrita em ${sourceLang}.
Transcreva TODO o texto manuscrito desta imagem com máxima fidelidade.
Inclua: texto cursivo, letra de forma, anotações, tópicos, listas — qualquer texto visível.

Regras:
- Preserve a estrutura original (parágrafos, tópicos com bullet points, listas)
- Se uma palavra for ilegível, use [?] no lugar
- Não adicione comentários, apenas o texto transcrito
- Mantenha a pontuação original`
    }

    // Chama GPT-4o Vision
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: 'high'  // máxima qualidade de análise
              }
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('OpenAI error:', err)
      return new Response(JSON.stringify({ error: 'Erro no GPT-4o Vision: ' + err }), {
        status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content?.trim() || ''

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Erro:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
