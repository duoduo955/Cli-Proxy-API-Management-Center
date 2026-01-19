export interface KiroUsageInfo {
  subscription_title: string;
  credit_usage: number;
  monthly_credit_limit: number;
  next_reset_date?: string;
  trial_expiry_date?: string;
}

export interface KiroQuotaItem {
  id: string;
  label: string;
  labelKey?: string;
  percentUsed: number;
  usage: number;
  limit: number;
  unit?: string;
}

export interface KiroQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  items?: KiroQuotaItem[];
  subscriptionTitle?: string;
  nextResetDate?: string;
  trialExpiryDate?: string;
  error?: string;
  errorStatus?: number;
}
