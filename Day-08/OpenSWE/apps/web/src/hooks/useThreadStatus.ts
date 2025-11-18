/**
 * @file useThreadStatus.ts
 * @description
 * 스레드의 실시간 상태와 작업 계획을 관리하는 커스텀 훅.
 * SWR을 사용하여 스레드 상태를 자동으로 폴링하고 업데이트합니다.
 */

import useSWR from "swr";
import {
  THREAD_STATUS_SWR_CONFIG,
  TASK_PLAN_SWR_CONFIG,
} from "@/lib/swr-config";
import { ThreadUIStatus, ThreadStatusData } from "@/lib/schemas/thread-status";
import { fetchThreadStatus } from "@/services/thread-status.service";
import { TaskPlan } from "@openswe/shared/open-swe/types";

interface UseThreadStatusOptions {
  /** 훅 활성화 여부 (기본값: true) */
  enabled?: boolean;
  /** 커스텀 갱신 주기 (밀리초) */
  refreshInterval?: number;
  /** 고빈도 작업 계획 설정 사용 여부 */
  useTaskPlanConfig?: boolean;
}

interface ThreadStatusResult {
  /** 스레드 UI 상태 */
  status: ThreadUIStatus;
  /** 작업 계획 데이터 */
  taskPlan?: TaskPlan;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 */
  error: Error | null;
  /** 데이터 재조회 함수 */
  mutate: () => void;
}

/**
 * @hook useThreadStatus
 * @description
 * 스레드의 실시간 상태를 SWR로 관리하는 커스텀 훅.
 * Zustand 수동 캐시 대신 SWR 캐싱을 직접 사용하며,
 * 실시간 진행률 업데이트를 위해 고빈도 작업 계획 설정을 사용할 수 있습니다.
 *
 * @features
 * - SWR 기반 자동 폴링 및 재검증
 * - 작업 계획 실시간 업데이트
 * - 선택적 고빈도 갱신 모드
 * - 조건부 활성화
 *
 * @example
 * ```tsx
 * // 기본 사용
 * const { status, taskPlan, isLoading } = useThreadStatus(threadId);
 *
 * // 고빈도 모드 (실시간 진행률)
 * const { taskPlan } = useThreadStatus(threadId, {
 *   useTaskPlanConfig: true,
 * });
 *
 * // 조건부 활성화
 * const { status } = useThreadStatus(threadId, {
 *   enabled: isActive,
 * });
 * ```
 */
export function useThreadStatus(
  threadId: string,
  options: UseThreadStatusOptions = {},
): ThreadStatusResult {
  const {
    enabled = true,
    refreshInterval,
    useTaskPlanConfig = false,
  } = options;

  const swrConfig = useTaskPlanConfig
    ? TASK_PLAN_SWR_CONFIG
    : THREAD_STATUS_SWR_CONFIG;

  const finalConfig = refreshInterval
    ? { ...swrConfig, refreshInterval }
    : swrConfig;

  const swrKey = enabled ? `thread-status-${threadId}` : null;

  const { data, error, isLoading, mutate } = useSWR<ThreadStatusData>(
    swrKey,
    () => fetchThreadStatus(threadId),
    finalConfig,
  );

  return {
    status: data?.status || "idle",
    taskPlan: data?.taskPlan,
    isLoading,
    error: data?.error ?? error,
    mutate,
  };
}
