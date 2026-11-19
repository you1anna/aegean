import toolchain from '../../toolchain.json' with { type: 'json' };
import { digest } from './digest.js';
import { ModelPolicySchema } from './model-policy.js';

export interface PolicyPins { policy: string; maxModelCalls: number; maxRepairs: number; maxRevisions: number; maxInfrastructureRetries: number; activeTimeoutMs: number; models: unknown }
/** The key order of this object is part of the policy identity. Do not reorder it. */
export function policyFromToolchain(pins: PolicyPins) {
  if (!pins || typeof pins.policy !== 'string' || !/^\d+\.\d+\.\d+$/.test(pins.policy) || [pins.maxModelCalls, pins.maxRepairs, pins.maxRevisions, pins.maxInfrastructureRetries, pins.activeTimeoutMs].some(value => !Number.isSafeInteger(value) || value < 0) || (pins.activeTimeoutMs === 0 || pins.maxModelCalls === 0)) throw new Error('invalid workflow policy pins');
  return Object.freeze({ models: ModelPolicySchema.parse(pins.models), version: pins.policy, maxModelCalls: pins.maxModelCalls, maxRepairs: pins.maxRepairs, maxRevisions: pins.maxRevisions, maxInfrastructureRetries: pins.maxInfrastructureRetries, activeTimeoutMs: pins.activeTimeoutMs });
}
export const policyIdentityFor = (pins: PolicyPins): string => digest(JSON.stringify(policyFromToolchain(pins)));
export const POLICY = policyFromToolchain(toolchain);
export const POLICY_IDENTITY = policyIdentityFor(toolchain);
