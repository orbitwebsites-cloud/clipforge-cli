import { auth, currentUser } from '@clerk/nextjs/server';
import { ensureTenant } from './repository';

export async function tenantIdFromSession() {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
  return `tenant_${userId}`;
}

export async function ensureCurrentTenant() {
  const user = await currentUser();
  if (!user) throw new Error('Not authenticated');
  const email = user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error('Your account needs a verified email address');
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || email.split('@')[0];
  return ensureTenant(`tenant_${user.id}`, { email, name });
}
