import Stripe from 'stripe';
import { query } from '@/lib/db';

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return new Response('Stripe not configured', { status: 503 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), request.headers.get('stripe-signature') || '', process.env.STRIPE_WEBHOOK_SECRET); }
  catch (error) { return new Response(error instanceof Error ? error.message : 'Invalid signature', { status: 400 }); }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const tenantId = session.metadata?.tenantId;
    if (tenantId) await query(`update tenants set stripe_customer_id=$2,stripe_subscription_id=$3,
      plan=case when complimentary_creator then 'creator' else $4 end,subscription_status='active',
      monthly_clip_limit=case when complimentary_creator then 150 when $4='studio' then 500 else 150 end,
      source_channel_limit=case when complimentary_creator then 5 when $4='studio' then 20 else 5 end where id=$1`, [tenantId, String(session.customer || ''), String(session.subscription || ''), session.metadata?.plan || 'creator']);
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    await query(`update tenants set subscription_status=case when complimentary_creator then 'active' else $2 end,
      plan=case when complimentary_creator then 'creator' else plan end where stripe_subscription_id=$1`, [subscription.id, subscription.status]);
  }
  return new Response('ok');
}
