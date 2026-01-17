/**
 * Copilot quota types - isolated to minimize merge conflicts.
 */

// API response types from backend
export interface CopilotQuotaDetail {
  entitlement: number;
  overage_count: number;
  overage_permitted: boolean;
  percent_remaining: number;
  quota_id: string;
  quota_remaining: number;
  remaining: number;
  unlimited: boolean;
}

export interface CopilotQuotaSnapshots {
  chat: CopilotQuotaDetail;
  completions: CopilotQuotaDetail;
  premium_interactions: CopilotQuotaDetail;
}

export interface CopilotUsageResponse {
  access_type_sku?: string;
  copilot_plan?: string;
  quota_reset_date?: string;
  quota_snapshots?: CopilotQuotaSnapshots;
}

// UI state types
export interface CopilotQuotaItem {
  id: string;
  label: string;
  labelKey?: string;
  percentRemaining: number | null;
  quotaRemaining: number | null;
  entitlement: number | null;
  unlimited: boolean;
}

export interface CopilotQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: CopilotQuotaItem[];
  copilotPlan?: string | null;
  quotaResetDate?: string | null;
  error?: string;
  errorStatus?: number;
}