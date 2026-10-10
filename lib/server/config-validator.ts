/**
 * Safe configuration validation for SWARM AI backend
 * This module validates required environment variables at startup
 * without exposing secret values in logs or error messages.
 */

import { ManagedError } from './entitlements';
import { envNames } from './providers';

export interface ConfigIssue {
  category: 'provider' | 'payment' | 'general';
  severity: 'error' | 'warning';
  message: string;
  requiredEnvVar?: string;
}

export function validateConfiguration(): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  // Validate provider credentials
  const configuredProviders: string[] = [];
  for (const [providerId, varNames] of Object.entries(envNames)) {
    const hasCredential = varNames.some(name => {
      const value = process.env[name];
      return value && value.trim().length > 0;
    });
    if (hasCredential) {
      configuredProviders.push(providerId);
    }
  }

  if (configuredProviders.length === 0) {
    issues.push({
      category: 'provider',
      severity: 'error',
      message: 'No AI provider credentials are configured. Configure at least one provider API key to enable AI functionality.',
      requiredEnvVar: 'GROQ_API_KEY (recommended) or OPENROUTER_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY'
    });
  } else {
    issues.push({
      category: 'provider',
      severity: 'warning',
      message: `${configuredProviders.length} provider(s) configured: ${configuredProviders.join(', ')}. AI functionality is available.`
    });
  }

  // Validate model allowlists
  const standardModels = process.env.SWARM_STANDARD_MODELS || '';
  const premiumModels = process.env.SWARM_PREMIUM_MODELS || '';

  if (!standardModels.trim()) {
    issues.push({
      category: 'provider',
      severity: 'error',
      message: 'SWARM_STANDARD_MODELS is not configured. Set at least one provider:model pair (e.g., groq:openai/gpt-oss-20b).',
      requiredEnvVar: 'SWARM_STANDARD_MODELS'
    });
  } else {
    // Check if allowlist matches configured providers
    const allowedProviders = new Set(standardModels.split(',').map(m => m.split(':')[0].trim()));
    const missingProviders = configuredProviders.filter(p => !allowedProviders.has(p));
    if (missingProviders.length > 0) {
      issues.push({
        category: 'provider',
        severity: 'warning',
        message: `Configured providers not in allowlist: ${missingProviders.join(', ')}. Add them to SWARM_STANDARD_MODELS.`
      });
    }
  }

  // Validate Cashfree configuration
  const cashfreeEnv = process.env.CASHFREE_ENV || 'sandbox';
  if (cashfreeEnv !== 'sandbox' && cashfreeEnv !== 'production') {
    issues.push({
      category: 'payment',
      severity: 'error',
      message: `CASHFREE_ENV must be 'sandbox' or 'production', got '${cashfreeEnv}'.`,
      requiredEnvVar: 'CASHFREE_ENV'
    });
  }

  if (cashfreeEnv === 'sandbox') {
    const hasSandboxId = process.env.CASHFREE_SANDBOX_CLIENT_ID && process.env.CASHFREE_SANDBOX_CLIENT_ID.trim().length > 0;
    const hasSandboxSecret = process.env.CASHFREE_SANDBOX_CLIENT_SECRET && process.env.CASHFREE_SANDBOX_CLIENT_SECRET.trim().length > 0;

    if (!hasSandboxId || !hasSandboxSecret) {
      issues.push({
        category: 'payment',
        severity: 'error',
        message: 'Cashfree sandbox credentials are missing. Configure CASHFREE_SANDBOX_CLIENT_ID and CASHFREE_SANDBOX_CLIENT_SECRET for payment testing.',
        requiredEnvVar: 'CASHFREE_SANDBOX_CLIENT_ID and CASHFREE_SANDBOX_CLIENT_SECRET'
      });
    } else {
      issues.push({
        category: 'payment',
        severity: 'warning',
        message: 'Cashfree sandbox mode is configured. Payment checkout is available for testing.'
      });
    }
  } else if (cashfreeEnv === 'production') {
    const hasProdId = process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_ID.trim().length > 0;
    const hasProdSecret = process.env.CASHFREE_CLIENT_SECRET && process.env.CASHFREE_CLIENT_SECRET.trim().length > 0;

    if (!hasProdId || !hasProdSecret) {
      issues.push({
        category: 'payment',
        severity: 'error',
        message: 'Cashfree production credentials are missing. Configure CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET for live payments.',
        requiredEnvVar: 'CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET'
      });
    } else {
      issues.push({
        category: 'payment',
        severity: 'warning',
        message: 'Cashfree production mode is configured. Live payments are enabled.'
      });
    }
  }

  // Validate public URL
  const publicUrl = process.env.SWARM_PUBLIC_URL;
  if (!publicUrl || !publicUrl.trim()) {
    issues.push({
      category: 'general',
      severity: 'error',
      message: 'SWARM_PUBLIC_URL is not configured. Set the public URL for webhooks and payment redirects.',
      requiredEnvVar: 'SWARM_PUBLIC_URL'
    });
  }

  // Validate Pro plan configuration
  const proBuilds = process.env.SWARM_PRO_BUILDS;
  const proChats = process.env.SWARM_PRO_CHATS;

  if (!proBuilds || !proChats) {
    issues.push({
      category: 'general',
      severity: 'warning',
      message: 'Pro plan fair-use limits are not configured. SWARM_PRO_BUILDS and SWARM_PRO_CHATS are required for Pro functionality.',
      requiredEnvVar: 'SWARM_PRO_BUILDS and SWARM_PRO_CHATS'
    });
  }

  return issues;
}

export function logConfigurationIssues(issues: ConfigIssue[]): void {
  if (issues.length === 0) {
    console.log('✓ Configuration validation passed');
    return;
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.error('Configuration errors:');
    for (const issue of errors) {
      console.error(`  ✗ [${issue.category.toUpperCase()}] ${issue.message}`);
      if (issue.requiredEnvVar) {
        console.error(`    Required: ${issue.requiredEnvVar}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('Configuration warnings:');
    for (const issue of warnings) {
      console.warn(`  ⚠ [${issue.category.toUpperCase()}] ${issue.message}`);
    }
  }
}

export function throwIfConfigurationInvalid(issues: ConfigIssue[]): void {
  // Skip validation in test environment
  const isTestEnv = process.env.NODE_ENV === 'test' || 
                      process.env.SWARM_DATA_DIR?.includes('swarm-web-test') ||
                      process.env.SWARM_DATA_DIR?.includes('swarm-managed-api') ||
                      process.env.SWARM_DATA_DIR?.includes('swarm-web-') ||
                      process.env.SWARM_DATA_DIR?.includes('swarm-route-auth') ||
                      process.env.SWARM_DATA_DIR?.includes('swarm-cashfree-auth') ||
                      process.env.TMPDIR?.includes('swarm');
  if (isTestEnv) {
    return;
  }
  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    throw new ManagedError(503, 'configuration', 'SWARM AI is not properly configured. See server logs for details.');
  }
}
