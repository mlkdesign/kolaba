// The offer to switch the account's type (AccountRoles.roleSwitchAlert): a creator who wants to create a job is
// offered the business profile (or to create one), a business that wants to apply the creator profile. The switch is
// in context (no jump to My Profile); the server still decides — a creator can never publish a job through the API.
import type { ProfileType } from './api';
import { profiles, push, setActiveProfile } from './state';
import { alertDialog } from './ui';

export type RoleOffer = 'createJob' | 'apply' | 'manageJob';

const copy: Record<RoleOffer, { target: ProfileType; title: string; message: string; create: string }> = {
  createJob: { target: 'business', title: 'Switch to Business Profile?', message: 'You need a Business Profile to create a job.',
    create: 'You need a Business Profile to create a job. Create one — your creator profile stays as it is.' },
  manageJob: { target: 'business', title: 'Switch to Business Profile?', message: 'This job was published by your Business Profile. Switch to manage it.',
    create: '' },
  apply: { target: 'creator', title: 'Switch to Creator Profile?', message: 'You need a Creator Profile to apply for this job.',
    create: 'You need a Creator Profile to apply for this job. Create one — your business profile stays as it is.' },
};

/** Asks, then switches (or creates the profile first) and runs `then` in the new role. */
export function offerRoleSwitch(offer: RoleOffer, then?: () => void) {
  const c = copy[offer];
  const existing = profiles.value.find((p) => p.type === c.target);
  if (existing) {
    alertDialog(c.title, c.message, 'Switch account', () => { setActiveProfile(existing.id, false); then?.(); }, false);
    return;
  }
  const label = c.target === 'business' ? 'Business' : 'Creator';
  alertDialog(`Create a ${label} Profile?`, c.create, `Create ${label} Profile`, () => { push('create-profile', { type: c.target, then }); }, false);
}
