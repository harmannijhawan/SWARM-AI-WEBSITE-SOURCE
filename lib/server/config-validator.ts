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

  if (!Object.values(envNames).flat().some(name => process.env[name]?.trim())) issues.push({category:'provider',severity:'error',message:'No server provider key is configured.'});
  if (!process.env.SWARM_STANDARD_MODELS?.trim()) issues.push({category:'provider',severity:'error',message:'Configure SWARM_STANDARD_MODELS with approved provider:model IDs.'});
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
