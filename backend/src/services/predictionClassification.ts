/**
 * Marker used to distinguish a rule-based detection of an existing fault
 * from a forecast of a future fault. Kept in explanationText to avoid a schema
 * migration; all code should use these helpers rather than parsing prose.
 */
export const ACTIVE_FAULT_DETECTION_PREFIX = "[ACTIVE_FAULT_DETECTION]";
export const LEGACY_RULE_BASED_PREFIX = "[RULE_BASED]";

export function isActiveFaultDetection(explanationText: string): boolean {
  return (
    explanationText.startsWith(ACTIVE_FAULT_DETECTION_PREFIX) ||
    explanationText.startsWith(LEGACY_RULE_BASED_PREFIX)
  );
}
