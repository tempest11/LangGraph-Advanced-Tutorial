/**
 * @file useThreadsSWR.ts
 * @description
 * LangGraph 스레드 목록을 조회하고 관리하는 커스텀 훅.
 * SWR을 사용하여 모든 그래프 타입의 스레드를 조회하며, 페이지네이션, 정렬, 조직 필터링을 지원합니다.
 */

import useSWR from "swr";
import { Thread } from "@langchain/langgraph-sdk";
import { createClient } from "@/providers/client";
import { THREAD_SWR_CONFIG } from "@/lib/swr-config";
import { ManagerGraphState } from "@openswe/shared/open-swe/manager/types";
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types";
import { ReviewerGraphState } from "@openswe/shared/open-swe/reviewer/types";
import { GraphState } from "@openswe/shared/open-swe/types";
import { useMemo, useState } from "react";
import type { Installation } from "./useGitHubInstallations";

/** 스레드 정렬 기준 */
type ThreadSortBy = "thread_id" | "status" | "created_at" | "updated_at";
/** 정렬 순서 */
type SortOrder = "asc" | "desc";

/**
 * Open SWE 시스템의 모든 가능한 그래프 상태를 표현하는 유니온 타입
 */
export type AnyGraphState =
  | ManagerGraphState
  | PlannerGraphState
  | ReviewerGraphState
  | GraphState;

interface UseThreadsSWROptions {
  /** Assistant ID (그래프 ID) */
  assistantId?: string;
  /** 갱신 주기 (밀리초) */
  refreshInterval?: number;
  /** 포커스 시 재검증 여부 */
  revalidateOnFocus?: boolean;
  /** 재연결 시 재검증 여부 */
  revalidateOnReconnect?: boolean;
  /** 현재 선택된 설치 정보 */
  currentInstallation?: Installation | null;
  /** 조직 필터링 비활성화 여부 */
  disableOrgFiltering?: boolean;
  /** 페이지네이션 옵션 */
  pagination?: {
    /** 최대 스레드 수 (기본값: 25) */
    limit?: number;
    /** 시작 오프셋 (기본값: 0) */
    offset?: number;
    /** 정렬 기준 (기본값: "updated_at") */
    sortBy?: ThreadSortBy;
    /** 정렬 순서 (기본값: "desc") */
    sortOrder?: SortOrder;
  };
}

/**
 * @hook useThreadsSWR
 * @description
 * 모든 그래프 타입의 스레드를 조회하는 커스텀 훅.
 * Manager, Planner, Programmer, Reviewer 등 모든 그래프 상태에서 작동하며,
 * 적절한 assistantId를 전달하여 특정 그래프의 스레드만 조회할 수 있습니다.
 *
 * @features
 * - SWR 기반 자동 캐싱 및 재검증
 * - 페이지네이션 및 정렬 지원
 * - 조직/사용자별 필터링
 * - 제네릭 타입으로 모든 그래프 상태 지원
 * - 중복 제거 및 오류 재시도
 *
 * @typeParam TGraphState - 조회할 그래프 상태 타입 (기본값: AnyGraphState)
 *
 * @example
 * ```tsx
 * // Manager 스레드 조회
 * const { threads, isLoading } = useThreadsSWR<ManagerGraphState>({
 *   assistantId: 'manager',
 *   currentInstallation,
 *   pagination: { limit: 10, sortBy: 'updated_at' },
 * });
 *
 * // 모든 그래프의 스레드 조회
 * const { threads } = useThreadsSWR({
 *   disableOrgFiltering: true,
 * });
 * ```
 *
 * @note
 * Manager 스레드를 UI에 표시할 때는 `threadsToMetadata(threads)` 유틸리티를 사용하여
 * 원시 스레드를 ThreadMetadata 객체로 변환하세요.
 */
export function useThreadsSWR<
  TGraphState extends AnyGraphState = AnyGraphState,
>(options: UseThreadsSWROptions = {}) {
  const {
    assistantId,
    refreshInterval = THREAD_SWR_CONFIG.refreshInterval,
    revalidateOnFocus = THREAD_SWR_CONFIG.revalidateOnFocus,
    revalidateOnReconnect = THREAD_SWR_CONFIG.revalidateOnReconnect,
    currentInstallation,
    disableOrgFiltering,
    pagination,
  } = options;
  const [hasMoreState, setHasMoreState] = useState(true);

  const paginationWithDefaults = {
    limit: 25,
    offset: 0,
    sortBy: "updated_at" as ThreadSortBy,
    sortOrder: "desc" as SortOrder,
    ...pagination,
  };

  const apiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL ?? "";

  // Create a unique key for SWR caching based on assistantId and pagination parameters
  const swrKey = useMemo(() => {
    const baseKey = assistantId ? ["threads", assistantId] : ["threads", "all"];
    if (pagination) {
      return [
        ...baseKey,
        paginationWithDefaults.limit,
        paginationWithDefaults.offset,
        paginationWithDefaults.sortBy,
        paginationWithDefaults.sortOrder,
      ];
    }
    return baseKey;
  }, [assistantId, paginationWithDefaults]);

  const fetcher = async (): Promise<Thread<TGraphState>[]> => {
    if (!apiUrl) {
      throw new Error("API URL is not configured");
    }

    const client = createClient(apiUrl);
    const searchArgs = assistantId
      ? {
          metadata: {
            graph_id: assistantId,
          },
          ...(paginationWithDefaults ? paginationWithDefaults : {}),
        }
      : paginationWithDefaults
        ? paginationWithDefaults
        : undefined;

    return await client.threads.search<TGraphState>(searchArgs);
  };

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    swrKey,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus,
      revalidateOnReconnect,
      errorRetryCount: THREAD_SWR_CONFIG.errorRetryCount,
      errorRetryInterval: THREAD_SWR_CONFIG.errorRetryInterval,
      dedupingInterval: THREAD_SWR_CONFIG.dedupingInterval,
    },
  );

  const threads = useMemo(() => {
    const allThreads = data ?? [];

    if (disableOrgFiltering) {
      return allThreads;
    }

    if (!allThreads.length) {
      setHasMoreState(false);
    }

    if (!currentInstallation) {
      setHasMoreState(false);
      return [];
    }

    return allThreads.filter((thread) => {
      const threadInstallationName = thread.metadata?.installation_name;
      return (
        typeof threadInstallationName === "string" &&
        threadInstallationName === currentInstallation.accountName
      );
    });
  }, [data, currentInstallation, disableOrgFiltering]);

  const hasMore = useMemo(() => {
    return hasMoreState && !!threads.length;
  }, [threads, paginationWithDefaults]);

  return {
    threads,
    error,
    isLoading,
    isValidating,
    mutate,
    hasMore,
  };
}
