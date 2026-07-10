/**
 * Feature Flags Configuration
 * Controls which features are enabled in development/production
 * All features default to FALSE (disabled) for safety
 */

export function isFeatureEnabled(featureName: string): boolean {
  switch (featureName) {
    case 'TEAM_LEADER_PERFORMANCE_HUB_ENABLED':
      return import.meta.env.VITE_FEATURE_TEAM_LEADER_PERFORMANCE_HUB === 'true';
    
    case 'COMMUNICATIONS_CONSOLE_ENABLED':
      return import.meta.env.VITE_COMMUNICATIONS_CONSOLE_ENABLED === 'true';
    
    case 'PORTAL_RECOVERY_ENABLED':
      return import.meta.env.VITE_PORTAL_RECOVERY_ENABLED === 'true';

    case 'TRAINING_HUB_ENABLED':
      return import.meta.env.DEV || import.meta.env.VITE_TRAINING_HUB_ENABLED === 'true';
    
    default:
      return false;
  }
}
