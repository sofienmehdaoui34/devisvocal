import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const PRIX_DEVIS_CHF = parseFloat(process.env.STRIPE_PRICE_DEVIS ?? '2.90');

export async function createCheckoutSession(params: {
  devisToken: string;
  devisNumero: string;
  artisanEmail?: string;
  stripeCustomerId?: string;
  appUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  // Stripe interdit customer ET customer_email ensemble.
  // On n'inclut qu'UNE seule clé (ou aucune) via spread conditionnel —
  // jamais une clé à null/undefined qui ferait planter l'appel.
  const customerParams: { customer?: string; customer_email?: string } =
    params.stripeCustomerId
      ? { customer: params.stripeCustomerId }
      : params.artisanEmail
        ? { customer_email: params.artisanEmail }
        : {};

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    ...customerParams,
    line_items: [
      {
        price_data: {
          currency: 'chf',
          product_data: {
            name: `Devis professionnel PDF — ${params.devisNumero}`,
            description: 'Génération et envoi de votre devis au format PDF',
          },
          unit_amount: Math.round(PRIX_DEVIS_CHF * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${params.appUrl}/devis/${params.devisToken}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.appUrl}/devis/${params.devisToken}`,
    metadata: {
      devis_token: params.devisToken,
    },
  });

  return { url: session.url!, sessionId: session.id };
}

export async function createOrGetStripeCustomer(
  email: string,
  nomEntreprise: string,
  whatsappNumber: string
): Promise<string> {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0].id;

  const customer = await stripe.customers.create({
    email,
    name: nomEntreprise,
    metadata: { whatsapp_number: whatsappNumber },
  });
  return customer.id;
}

export async function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}

export async function getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
}
