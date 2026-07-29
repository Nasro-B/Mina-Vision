export function createSmartHomePolicy({ firebaseLowRiskEnabled = false } = {}) {
  function decide({ device, action, sourceChannel, confirmedLocally = false } = {}) {
    if (!device?.enabled || !device.capabilities?.includes(action)) return Object.freeze({ decision: 'deny', reason: 'capability_unavailable' });
    if (!['local_ui', 'voice', 'telegram', 'firebase'].includes(sourceChannel)) return Object.freeze({ decision: 'deny', reason: 'channel_forbidden' });
    if (device.riskTier === 'blocked' || device.riskTier === 'high') return Object.freeze({ decision: 'deny', reason: 'risk_blocked' });
    if (sourceChannel === 'telegram') {
      if (device.riskTier === 'medium') return Object.freeze({ decision: 'confirm', reason: 'telegram_medium_requires_local_confirmation' });
      return Object.freeze({ decision: 'deny', reason: 'remote_channel_requires_firebase' });
    }
    if (sourceChannel === 'firebase') {
      if (device.riskTier !== 'low') return Object.freeze({ decision: 'deny', reason: 'firebase_low_risk_only' });
      if (!firebaseLowRiskEnabled) return Object.freeze({ decision: 'deny', reason: 'firebase_home_forbidden' });
    }
    if (device.confirmationPolicy === 'local_only' && !confirmedLocally) {
      return Object.freeze({ decision: 'confirm', reason: 'local_confirmation_required' });
    }
    if ((device.riskTier === 'medium' || device.confirmationPolicy === 'always') && !confirmedLocally) {
      return Object.freeze({ decision: 'confirm', reason: 'confirmation_required' });
    }
    return Object.freeze({ decision: 'allow' });
  }
  return Object.freeze({ decide });
}
