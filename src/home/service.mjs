import { createSmartHomeCommandLedger } from './home-command-ledger.mjs';
import { createSmartHomeVerifier } from './home-verifier.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSmartHomeService({ registry, policy, router, now = Date.now, ledger, verifier } = {}) {
  if (!registry?.resolve || !policy?.decide || !router?.resolve) throw new TypeError('smart_home_service_dependencies_required');
  const commandLedger = ledger ?? createSmartHomeCommandLedger({ now });
  const stateVerifier = verifier ?? createSmartHomeVerifier();

  async function execute({ commandId, intent, expiresAt, confirmedLocally = false, offline = false } = {}) {
    if (!UUID_V4.test(commandId ?? '')) throw new TypeError('smart_home_command_id_invalid');
    const current = now();
    const maximumTtlMs = intent?.sourceChannel === 'firebase' ? 30_000 : 60_000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= current || expiresAt - current > maximumTtlMs) {
      throw new Error('smart_home_command_expired');
    }

    const begun = commandLedger.begin({ commandId, expiresAt, action: intent?.action });
    if (begun.status === 'duplicate') return structuredClone(begun.receipt);
    if (begun.status === 'pending') return Object.freeze({ commandId, state: 'in_progress', verified: false });

    const finish = (receipt) => commandLedger.finish(commandId, receipt);

    const target = registry.resolve({ targetText: intent?.targetText, roomText: intent?.roomText });
    if (target.status !== 'resolved') return structuredClone(finish({ commandId, state: target.status === 'ambiguous' ? 'clarification_required' : 'target_not_found', verified: false, ...(target.candidates ? { candidates: target.candidates } : {}) }));
    const device = target.device;
    const decision = policy.decide({ device, action: intent.action, sourceChannel: intent.sourceChannel, confirmedLocally });
    if (decision.decision !== 'allow') return structuredClone(finish({ commandId, deviceId: device.deviceId, state: decision.decision === 'confirm' ? 'awaiting_confirmation' : 'denied', reason: decision.reason, verified: false }));
    const route = router.resolve({ device, action: intent.action, offline });
    if (route.status !== 'resolved') return structuredClone(finish({ commandId, deviceId: device.deviceId, state: 'connector_unavailable', verified: false }));
    const command = Object.freeze({ commandId, deviceId: device.deviceId, action: intent.action, desiredState: structuredClone(intent.desiredState), issuedAt: current, expiresAt, sourceChannel: intent.sourceChannel });
    try {
      if (intent.action === 'read_state') {
        const observed = await route.connector.readState(route.binding);
        return structuredClone(finish({ commandId, deviceId: device.deviceId, state: 'state_confirmed', verified: true, observedState: observed, connectorId: route.connector.id }));
      }
      const accepted = await route.connector.execute(route.binding, command);
      const observed = accepted?.accepted ? await route.connector.readState(route.binding) : null;
      const verified = stateVerifier.verify({ accepted: accepted?.accepted === true, observedState: observed, desiredState: intent.desiredState });
      return structuredClone(finish({ commandId, deviceId: device.deviceId, ...verified, connectorId: route.connector.id }));
    } catch (error) {
      return structuredClone(finish({ commandId, deviceId: device.deviceId, state: 'failed', verified: false, reason: String(error?.message ?? 'connector_failed').slice(0, 160) }));
    }
  }

  return Object.freeze({ execute, getReceipt: (commandId) => structuredClone(commandLedger.getReceipt(commandId)) });
}
