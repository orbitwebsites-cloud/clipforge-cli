import Stripe from 'stripe';
import { z } from 'zod';
import { getDashboard } from '@/lib/repository';
import { tenantIdFromSession } from '@/lib/session';
import { appUrl } from '@/lib/app-url';

export async function POST(request: Request) {
  try {
    const { plan } = z.object({ plan: z.enum(['creator', 'studio']) }).parse(await request.json());
    const tenantId = await tenantIdFromSession();
    if (plan === 'creator' && process.env.WHOP_CREATOR_CHECKOUT_URL) return Response.json({ url: process.env.WHOP_CREATOR_CHECKOUT_URL });
    if (!process.env.STRIPE_SECRET_KEY) return Response.json({ url: '/dashboard?checkout=demo' });
    const tenant = (await getDashboard(tenantId)).tenant;
    const price = plan === 'studio' ? process.env.STRIPE_PRICE_STUDIO : process.env.STRIPE_PRICE_CREATOR;
    if (!price) throw new Error(`Stripe price for ${plan} is not configured`);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer: tenant.stripeCustomerId || undefined, customer_email: tenant.stripeCustomerId ? undefined : tenant.email, line_items: [{ price, quantity: 1 }], success_url: `${appUrl()}/dashboard?checkout=success`, cancel_url: `${appUrl()}/dashboard?checkout=canceled`, allow_promotion_codes: true, subscription_data: { metadata: { tenantId, plan } }, metadata: { tenantId, plan } });
    return Response.json({ url: session.url });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Checkout failed' }, { status: 400 }); }
}
