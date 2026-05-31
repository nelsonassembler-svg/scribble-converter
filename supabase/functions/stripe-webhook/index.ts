import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Sem assinatura', { status: 400 })
  }

  let event: Stripe.Event

  try {
    const body = await req.text()
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook inválido:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log(`Evento recebido: ${event.type}`)

  try {
    switch (event.type) {

      // ✅ Assinatura criada ou renovada com sucesso
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const plan = sub.items.data[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'
        const active = sub.status === 'active' || sub.status === 'trialing'

        // Busca o e-mail do cliente no Stripe
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
        const email = customer.email

        if (!email) break

        // Atualiza o usuário no Supabase Auth
        const { data: users } = await supabase.auth.admin.listUsers()
        const user = users?.users?.find(u => u.email === email)

        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: {
              premium: active,
              plan: active ? plan : 'free',
              stripe_customer_id: customerId,
              subscription_id: sub.id,
              subscription_status: sub.status,
              premium_since: active ? new Date().toISOString() : null,
            }
          })

          // Salva também na tabela profiles (se existir)
          await supabase.from('profiles').upsert({
            id: user.id,
            email: email,
            premium: active,
            plan: active ? plan : 'free',
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' }).maybeSingle()

          console.log(`✅ Usuário ${email} → Premium ${active} (${plan})`)
        }
        break
      }

      // ❌ Assinatura cancelada ou pagamento falhou
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const obj = event.data.object as any
        const customerId = obj.customer as string

        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
        const email = customer.email
        if (!email) break

        const { data: users } = await supabase.auth.admin.listUsers()
        const user = users?.users?.find(u => u.email === email)

        if (user) {
          await supabase.auth.admin.updateUserById(user.id, {
            user_metadata: {
              premium: false,
              plan: 'free',
              subscription_status: 'canceled',
            }
          })

          await supabase.from('profiles').upsert({
            id: user.id,
            email: email,
            premium: false,
            plan: 'free',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' }).maybeSingle()

          console.log(`❌ Usuário ${email} → Premium removido`)
        }
        break
      }

      // ✅ Pagamento confirmado
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        console.log(`💰 Pagamento confirmado: ${invoice.amount_paid / 100} ${invoice.currency.toUpperCase()}`)
        break
      }
    }
  } catch (err) {
    console.error('Erro ao processar evento:', err)
    return new Response('Erro interno', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
