/**
 * Kiro quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem, ResolvedTheme, ThemeColors } from '@/types';
import type {
  KiroQuotaState,
  KiroQuotaItem,
  KiroUsageInfo
} from '@/types/kiroQuota';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from './CopilotQuotaSection.module.scss'; // Reuse styles for now

// Kiro type colors (AWS Orange-ish)
const KIRO_COLORS = {
  light: { bg: '#fff7ed', text: '#c2410c' },
  dark: { bg: '#431407', text: '#fdba74' }
};

// Check if file is a Kiro OAuth file
function isKiroFile(file: AuthFileItem): boolean {
  const provider = (file.provider ?? file.type ?? '').toString().trim().toLowerCase();
  return provider === 'kiro' || provider.startsWith('kiro-');
}

// Zustand-like local store for Kiro quota
function useKiroQuotaStore() {
  const [quotaMap, setQuotaMap] = useState<Record<string, KiroQuotaState>>({});

  const setQuota = useCallback((fileName: string, state: KiroQuotaState) => {
    setQuotaMap((prev) => ({ ...prev, [fileName]: state }));
  }, []);

  const clearQuota = useCallback(() => {
    setQuotaMap({});
  }, []);

  return { quotaMap, setQuota, clearQuota };
}

// Build quota items from API response
function buildKiroQuotaItems(
  usage: KiroUsageInfo | undefined,
  t: TFunction
): KiroQuotaItem[] {
  if (!usage) return [];

  const items: KiroQuotaItem[] = [];

  // Credit Usage
  items.push({
    id: 'credit_usage',
    label: t('kiro_quota.credit_usage'),
    labelKey: 'kiro_quota.credit_usage',
    percentUsed: (usage.credit_usage / usage.monthly_credit_limit) * 100,
    usage: usage.credit_usage,
    limit: usage.monthly_credit_limit,
    unit: '$'
  });

  // Context Usage
  items.push({
    id: 'context_usage',
    label: t('kiro_quota.context_usage'),
    labelKey: 'kiro_quota.context_usage',
    percentUsed: usage.context_usage_percent,
    usage: usage.context_usage_percent,
    limit: usage.monthly_context_limit,
    unit: '%'
  });

  return items;
}

// Fetch Kiro quota from backend Management API
async function fetchKiroQuota(
  file: AuthFileItem,
  t: TFunction
): Promise<{ items: KiroQuotaItem[]; subscriptionTitle: string | undefined }> {
  const authId = file.id ?? file.auth_id ?? file.authId ?? file.name;
  if (!authId) {
    throw new Error(t('kiro_quota.missing_auth_id'));
  }

  const response = await apiClient.get<KiroUsageInfo>(
    `/kiro/quota?auth_id=${encodeURIComponent(authId)}`
  );

  const items = buildKiroQuotaItems(response, t);
  const subscriptionTitle = response.subscription_title || undefined;

  return { items, subscriptionTitle };
}

// Progress bar component (Reusing logic but inverted logic for usage vs remaining?)
// Copilot was "Percent Remaining", Kiro is "Percent Used".
// So for Kiro, "Low" usage is good (Green/Blue), "High" usage is bad (Red/Orange).
function QuotaProgressBar({
  percent,
  highThreshold = 80,
  mediumThreshold = 50
}: {
  percent: number | null;
  highThreshold?: number;
  mediumThreshold?: number;
}) {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  
  // For usage: High is bad (Orange/Red), Low is good (Blue/Green)
  // Re-using Copilot styles but mapping differently might be confusing if names are "FillHigh" etc.
  // Assuming Copilot styles: High = Good (Green), Low = Bad (Red).
  // So for Kiro Usage:
  // Low Usage (<50%) -> "High" style (Green)
  // Medium Usage (50-80%) -> "Medium" style (Yellow)
  // High Usage (>80%) -> "Low" style (Red)

  let fillClass = styles.quotaBarFillMedium;
  if (normalized !== null) {
      if (normalized < mediumThreshold) {
          fillClass = styles.quotaBarFillHigh; // Green-ish
      } else if (normalized < highThreshold) {
          fillClass = styles.quotaBarFillMedium; // Yellow-ish
      } else {
          fillClass = styles.quotaBarFillLow; // Red-ish
      }
  }

  const widthPercent = Math.round(normalized ?? 0);

  return (
    <div className={styles.quotaBar}>
      <div
        className={`${styles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

// Quota card component
function KiroQuotaCard({
  item,
  quota,
  resolvedTheme
}: {
  item: AuthFileItem;
  quota?: KiroQuotaState;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();

  const typeColor: ThemeColors =
    resolvedTheme === 'dark' ? KIRO_COLORS.dark : KIRO_COLORS.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaErrorMessage =
    quota?.errorStatus === 404
      ? t('common.quota_update_required')
      : quota?.errorStatus === 403
        ? t('common.quota_check_credential')
        : quota?.error || t('common.unknown_error');

  const renderQuotaItems = () => {
    if (!quota || quota.status !== 'success') return null;

    const items = quota.items ?? [];
    if (items.length === 0) {
      return <div className={styles.quotaMessage}>{t('kiro_quota.empty_items')}</div>;
    }

    return (
      <>
        {quota.subscriptionTitle && (
          <div className={styles.copilotPlan}>
            <span className={styles.copilotPlanLabel}>{t('kiro_quota.plan_label')}</span>
            <span className={styles.copilotPlanValue}>{quota.subscriptionTitle}</span>
          </div>
        )}
        {items.map((qi) => {
          const percent = qi.percentUsed;
          const percentLabel = `${Math.round(percent)}%`;
          
          let quotaLabel = null;
          if (qi.unit === '$') {
              quotaLabel = `$${qi.usage.toFixed(2)} / $${qi.limit.toFixed(2)}`;
          } else if (qi.unit === '%') {
               // For context usage, it's just percentage, maybe 80% / 100% is redundant, but okay.
               quotaLabel = `${qi.usage.toFixed(1)}% / ${qi.limit.toFixed(0)}%`;
          }

          return (
            <div key={qi.id} className={styles.quotaRow}>
              <div className={styles.quotaRowHeader}>
                <span className={styles.quotaModel}>
                  {qi.labelKey ? t(qi.labelKey) : qi.label}
                </span>
                <div className={styles.quotaMeta}>
                  <span className={styles.quotaPercent}>{percentLabel}</span>
                  {quotaLabel && <span className={styles.quotaAmount}>{quotaLabel}</span>}
                </div>
              </div>
              <QuotaProgressBar percent={percent} />
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className={`${styles.fileCard} ${styles.copilotCard}`}>
      <div className={styles.cardHeader}>
        <span
          className={styles.typeBadge}
          style={{
            backgroundColor: typeColor.bg,
            color: typeColor.text
          }}
        >
          Kiro
        </span>
        <span className={styles.fileName}>{item.name}</span>
      </div>

      <div className={styles.quotaSection}>
        {quotaStatus === 'loading' ? (
          <div className={styles.quotaMessage}>{t('kiro_quota.loading')}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t('kiro_quota.idle')}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t('kiro_quota.load_failed', { message: quotaErrorMessage })}
          </div>
        ) : (
          renderQuotaItems()
        )}
      </div>
    </div>
  );
}

// Grid columns hook
function useGridColumns(minCardWidth: number): [number, React.RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const cols = Math.max(1, Math.floor(width / minCardWidth));
        setColumns(cols);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [minCardWidth]);

  return [columns, ref];
}

// Pagination hook
type ViewMode = 'paged' | 'all';
const MAX_ITEMS_PER_PAGE = 14;
const MAX_SHOW_ALL_THRESHOLD = 30;

function useKiroPagination<T>(items: T[], columns: number, viewMode: ViewMode) {
  const [page, setPage] = useState(1);

  const pageSize = useMemo(() => {
    if (viewMode === 'all') {
      return Math.max(1, items.length);
    }
    return Math.min(columns * 3, MAX_ITEMS_PER_PAGE);
  }, [viewMode, columns, items.length]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [viewMode]);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    goToPrev,
    goToNext
  };
}

// Main section component
interface KiroQuotaSectionProps {
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function KiroQuotaSection({ files, loading, disabled }: KiroQuotaSectionProps) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const { quotaMap, setQuota, clearQuota } = useKiroQuotaStore();

  const [columns, gridRef] = useGridColumns(380);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);

  const filteredFiles = useMemo(() => files.filter(isKiroFile), [files]);
  const showAllAllowed = filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const { pageSize, totalPages, currentPage, pageItems, goToPrev, goToNext } =
    useKiroPagination(filteredFiles, columns, effectiveViewMode);

  const pendingRefreshRef = useRef(false);
  const prevLoadingRef = useRef(loading);

  // Auto-switch to paged mode if too many files
  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  // Load quota for a single file
  const loadQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      setQuota(file.name, { status: 'loading', items: [] });
      try {
        const { items, subscriptionTitle } = await fetchKiroQuota(file, t);
        setQuota(file.name, {
          status: 'success',
          items,
          subscriptionTitle
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = (err as { status?: number })?.status;
        setQuota(file.name, {
          status: 'error',
          items: [],
          error: message,
          errorStatus: status
        });
      }
    },
    [setQuota, t]
  );

  // Load quota for all files
  const loadAllQuotas = useCallback(async () => {
    if (filteredFiles.length === 0) return;
    setSectionLoading(true);
    await Promise.all(filteredFiles.map(loadQuotaForFile));
    setSectionLoading(false);
  }, [filteredFiles, loadQuotaForFile]);

  // Handle refresh button
  const handleRefresh = useCallback(() => {
    pendingRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  // React to files loading completion
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (!pendingRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingRefreshRef.current = false;
    void loadAllQuotas();
  }, [loading, loadAllQuotas]);

  // Clear stale quota when files change
  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      clearQuota();
    }
  }, [filteredFiles.length, loading, clearQuota]);

  const isRefreshing = sectionLoading || loading;

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('kiro_quota.title')}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>{filteredFiles.length}</span>
      )}
    </div>
  );

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant={effectiveViewMode === 'paged' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant={effectiveViewMode === 'all' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                if (filteredFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('kiro_quota.refresh_button')}
            aria-label={t('kiro_quota.refresh_button')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
          </Button>
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t('kiro_quota.empty_title')}
          description={t('kiro_quota.empty_desc')}
        />
      ) : (
        <>
          <div ref={gridRef} className={styles.copilotGrid}>
            {pageItems.map((item) => (
              <KiroQuotaCard
                key={item.name}
                item={item}
                quota={quotaMap[item.name]}
                resolvedTheme={resolvedTheme}
              />
            ))}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button variant="secondary" size="sm" onClick={goToPrev} disabled={currentPage <= 1}>
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
