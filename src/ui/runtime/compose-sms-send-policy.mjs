export function createSmsSendPolicyAccessor({ getConfig, createPolicy } = {}) {
  if (typeof getConfig !== 'function' || typeof createPolicy !== 'function') {
    throw new TypeError('sms_send_policy_accessor_dependencies_required');
  }

  let policyInstance = null;

  return () => {
    if (policyInstance) return policyInstance;
    const { policy } = getConfig().sms;
    policyInstance = createPolicy({
      mode: policy.sendMode,
      allowlist: policy.allowlist,
      quietHoursStart: policy.quietHoursStart,
      quietHoursEnd: policy.quietHoursEnd,
      maxPerMinute: policy.maxPerMinute,
      maxPerDay: policy.maxPerDay,
    });
    return policyInstance;
  };
}
