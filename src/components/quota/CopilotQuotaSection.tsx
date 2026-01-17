/**
 * Copilot quota section component - isolated to minimize merge conflicts.
 * This component is self-contained and only needs to be imported in QuotaPage.
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
  CopilotQuotaState,
  CopilotQuotaItem,
  CopilotUsageResponse,
  CopilotQuotaSnapshots
} from '@/types/copilotQuota';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from './CopilotQuotaSection.module.scss';

// Copilot type colors
const COPILOT_COLORS = {
  light: { bg: '#f0f9ff', text: '#0369a1' },
  dark: { bg: '#0c4a6e', text: '#7dd3fc' }
};

// Check if file is a Copilot OAuth file
function isCopilotFile(file: AuthFileItem): boolean {
  const provider = (file.provider ?? file.type ?? '').toString().trim().toLowerCase();
  return provider === 'github-copilot';
}

// Zustand-like local store for Copilot quota
function useCopilotQuotaStore() {
  const [quotaMap, setQuotaMap] = useState<Record<string, CopilotQuotaState>>({});

  const setQuota = useCallback((fileName: string, state: CopilotQuotaState) => {
    setQuotaMap((prev) => ({ ...prev, [fileName]: state }));
  }, []);

  const clearQuota = useCallback(() => {
    setQuotaMap({});
  }, []);

  return { quotaMap, setQuota, clearQuota };
}

// Build quota items from API response
function buildCopilotQuotaItems(
  snapshots: CopilotQuotaSnapshots | undefined,
  t: TFunction
): CopilotQuotaItem[] {
  if (!snapshots) return [];

  const items: CopilotQuotaItem[] = [];

  // Premium Interactions (most important for Copilot users)
  if (snapshots.premium_interactions) {
    const p = snapshots.premium_interactions;
    items.push({
      id: 'premium_interactions',
      label: t('copilot_quota.premium_interactions'),
      labelKey: 'copilot_quota.premium_interactions',
      percentRemaining: p.unlimited ? 100 : p.percent_remaining,
      quotaRemaining: p.quota_remaining,
      entitlement: p.entitlement,
      unlimited: p.unlimited
    });
  }

  // Chat quota
  if (snapshots.chat) {
    const c = snapshots.chat;
    items.push({
      id: 'chat',
      label: t('copilot_quota.chat'),
      labelKey: 'copilot_quota.chat',
      percentRemaining: c.unlimited ? 100 : c.percent_remaining,
      quotaRemaining: c.quota_remaining,
      entitlement: c.entitlement,
      unlimited: c.unlimited
    });
  }

  // Completions quota
  if (snapshots.completions) {
    const comp = snapshots.completions;
    items.push({
      id: 'completions',
      label: t('copilot_quota.completions'),
      labelKey: 'copilot_quota.completions',
      percentRemaining: comp.unlimited ? 100 : comp.percent_remaining,
      quotaRemaining: comp.quota_remaining,
      entitlement: comp.entitlement,
      unlimited: comp.unlimited
    });
  }

  return items;
}

// Fetch Copilot quota from backend Management API
async function fetchCopilotQuota(
  file: AuthFileItem,
  t: TFunction
): Promise<{ items: CopilotQuotaItem[]; copilotPlan: string | null; quotaResetDate: string | null }> {
  // Use file.id as auth_id (backend returns "id" field in buildAuthFileEntry)
  const authId = file.id ?? file.auth_id ?? file.authId ?? file.name;
  if (!authId) {
    throw new Error(t('copilot_quota.missing_auth_id'));
  }

  const response = await apiClient.get<CopilotUsageResponse>(
    `/copilot/quota?auth_id=${encodeURIComponent(authId)}`
  );

  const items = buildCopilotQuotaItems(response.quota_snapshots, t);
  const copilotPlan = response.copilot_plan ?? null;
  const quotaResetDate = response.quota_reset_date ?? null;

  return { items, copilotPlan, quotaResetDate };
}

// Progress bar component
function QuotaProgressBar({
  percent,
  highThreshold = 60,
  mediumThreshold = 20
}: {
  percent: number | null;
  highThreshold?: number;
  mediumThreshold?: number;
}) {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
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

// Format reset date
function formatResetDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

// Quota card component
function CopilotQuotaCard({
  item,
  quota,
  resolvedTheme
}: {
  item: AuthFileItem;
  quota?: CopilotQuotaState;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();

  const typeColor: ThemeColors =
    resolvedTheme === 'dark' ? COPILOT_COLORS.dark : COPILOT_COLORS.light;

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
      return <div className={styles.quotaMessage}>{t('copilot_quota.empty_items')}</div>;
    }

    return (
      <>
        {quota.copilotPlan && (
          <div className={styles.copilotPlan}>
            <span className={styles.copilotPlanLabel}>{t('copilot_quota.plan_label')}</span>
            <span className={styles.copilotPlanValue}>{quota.copilotPlan}</span>
          </div>
        )}
        {items.map((qi) => {
          const percent = qi.percentRemaining;
          const percentLabel = qi.unlimited
            ? t('copilot_quota.unlimited')
            : percent === null
              ? '--'
              : `${Math.round(percent)}%`;
          const quotaLabel =
            qi.quotaRemaining !== null && qi.entitlement !== null && !qi.unlimited
              ? `${Math.round(qi.quotaRemaining)} / ${Math.round(qi.entitlement)}`
              : null;

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
              <QuotaProgressBar percent={qi.unlimited ? 100 : percent} />
            </div>
          );
        })}
        {quota.quotaResetDate && (
          <div className={styles.resetInfo}>
            <span className={styles.resetLabel}>{t('copilot_quota.reset_date')}</span>
            <span className={styles.resetValue}>{formatResetDate(quota.quotaResetDate)}</span>
          </div>
        )}
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
          Copilot
        </span>
        <span className={styles.fileName}>{item.name}</span>
      </div>

      <div className={styles.quotaSection}>
        {quotaStatus === 'loading' ? (
          <div className={styles.quotaMessage}>{t('copilot_quota.loading')}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t('copilot_quota.idle')}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t('copilot_quota.load_failed', { message: quotaErrorMessage })}
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

function useCopilotPagination<T>(items: T[], columns: number, viewMode: ViewMode) {
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
interface CopilotQuotaSectionProps {
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function CopilotQuotaSection({ files, loading, disabled }: CopilotQuotaSectionProps) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const { quotaMap, setQuota, clearQuota } = useCopilotQuotaStore();

  const [columns, gridRef] = useGridColumns(380);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);

  const filteredFiles = useMemo(() => files.filter(isCopilotFile), [files]);
  const showAllAllowed = filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const { pageSize, totalPages, currentPage, pageItems, goToPrev, goToNext } =
    useCopilotPagination(filteredFiles, columns, effectiveViewMode);

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
        const { items, copilotPlan, quotaResetDate } = await fetchCopilotQuota(file, t);
        setQuota(file.name, {
          status: 'success',
          items,
          copilotPlan,
          quotaResetDate
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
      <span>{t('copilot_quota.title')}</span>
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
            title={t('copilot_quota.refresh_button')}
            aria-label={t('copilot_quota.refresh_button')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
          </Button>
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t('copilot_quota.empty_title')}
          description={t('copilot_quota.empty_desc')}
        />
      ) : (
        <>
          <div ref={gridRef} className={styles.copilotGrid}>
            {pageItems.map((item) => (
              <CopilotQuotaCard
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