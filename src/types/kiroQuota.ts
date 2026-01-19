export interface KiroUsageInfo {
  subscription_title: string;
  credit_usage: number;
  context_usage_percent: number;
  monthly_credit_limit: number;
  monthly_context_limit: number;
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
  error?: string;
  errorStatus?: number;
}
