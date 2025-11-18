/**
 * @file useThreadsStatus.ts
 * @description
 * 다중 스레드의 상태를 병렬로 조회하고 관리하는 커스텀 훅.
 * SWR을 사용하여 여러 스레드의 상태를 효율적으로 캐싱하고 업데이트하며,
 * 세션 데이터 캐싱을 통해 "스레드당 단일 요청 + 세션 캐시" 목표를 달성합니다.
 */

import useSWR from "swr";
import { ThreadUIStatus, ThreadStatusData } from "@/lib/schemas/thread-status";
import { fetchThreadStatus } from "@/services/thread-status.service";
import { THREAD_STATUS_SWR_CONFIG } from "@/lib/swr-config";
import { useMemo, useRef } from "react";
import { Thread } from "@langchain/langgraph-sdk";
import { ManagerGraphState } from "@openswe/shared/open-swe/manager/types";
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types";
import { GraphState, TaskPlan } from "@openswe/shared/open-swe/types";

/** 세션 캐시 데이터 */
export interface SessionCacheData {
  /** Planner 스레드 데이터 */
  plannerData?: { thread: Thread<PlannerGraphState> };
  /** Programmer 스레드 데이터 */
  programmerData?: { thread: Thread<GraphState> };
  /** 캐시 타임스탬프 */
  timestamp: number;
}

/** 세션 캐시 맵 타입 */
export type SessionCache = Map<string, SessionCacheData>;

/** 스레드 ID를 키로 하는 상태 맵 */
interface ThreadStatusMap {
  [threadId: string]: ThreadUIStatus;
}

/** 스레드 ID를 키로 하는 작업 계획 맵 */
interface TaskPlanMap {
  [threadId: string]: TaskPlan;
}

/** 상태별 스레드 개수 */
interface ThreadStatusCounts {
  /** 전체 스레드 수 */
  all: number;
  /** 실행 중 */
  running: number;
  /** 완료됨 */
  completed: number;
  /** 실패함 */
  failed: number;
  /** 대기 중 */
  pending: number;
  /** 유휴 */
  idle: number;
  /** 일시정지 */
  paused: number;
  /** 에러 */
  error: number;
}

/** 상태별로 그룹화된 스레드 ID 목록 */
interface GroupedThreadIds {
  running: string[];
  completed: string[];
  failed: string[];
  pending: string[];
  idle: string[];
  paused: string[];
  error: string[];
}

interface UseThreadsStatusResult {
  /** 스레드 상태 맵 */
  statusMap: ThreadStatusMap;
  /** 작업 계획 맵 */
  taskPlanMap: TaskPlanMap;
  /** 상태별 개수 */
  statusCounts: ThreadStatusCounts;
  /** 상태별 그룹 */
  groupedThreads: GroupedThreadIds;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 발생 여부 */
  hasErrors: boolean;
}

const sessionDataCache: SessionCache = new Map();

const CACHE_TTL = 30000;

/**
 * 다중 스레드의 상태를 병렬로 조회
 * 세션 캐싱을 사용하여 "스레드당 단일 요청 + 세션 캐시" 목표 달성
 */
async function fetchAllThreadStatuses(
  threadIds: string[],
  lastPollingStates: Map<string, ThreadStatusData>,
  managerThreads?: Thread<ManagerGraphState>[],
): Promise<{
  statusMap: ThreadStatusMap;
  taskPlanMap: TaskPlanMap;
  updatedStates: Map<string, ThreadStatusData>;
}> {
  const statusPromises = threadIds.map(async (threadId) => {
    try {
      const lastState = lastPollingStates.get(threadId) || null;

      const managerThread = managerThreads?.find(
        (t) => t.thread_id === threadId,
      );

      const statusData = await fetchThreadStatus(
        threadId,
        lastState,
        managerThread,
        sessionDataCache,
      );
      return { threadId, status: statusData.status, statusData };
    } catch (error) {
      console.error(`Failed to fetch status for thread ${threadId}:`, error);
      return {
        threadId,
        status: "idle" as ThreadUIStatus,
        statusData: null,
      };
    }
  });

  const results = await Promise.all(statusPromises);
  const statusMap: ThreadStatusMap = {};
  const taskPlanMap: TaskPlanMap = {};
  const updatedStates = new Map<string, ThreadStatusData>();

  results.forEach(({ threadId, status, statusData }) => {
    statusMap[threadId] = status;
    if (statusData) {
      updatedStates.set(threadId, statusData);
      if (statusData.taskPlan) {
        taskPlanMap[threadId] = statusData.taskPlan;
      }
    }
  });

  return { statusMap, taskPlanMap, updatedStates };
}

/**
 * @hook useThreadsStatus
 * @description
 * 다중 스레드의 상태를 병렬로 조회하는 커스텀 훅.
 * SWR을 사용하여 캐싱 및 중복 제거를 수행하며, 상태 최적화를 통해 효율적으로 관리합니다.
 * 세션 캐싱을 통해 네트워크 요청을 최소화합니다.
 *
 * @features
 * - 병렬 스레드 상태 조회
 * - SWR 기반 자동 캐싱 및 재검증
 * - 세션 데이터 캐싱 (30초 TTL)
 * - 상태별 스레드 그룹화
 * - 상태별 개수 집계
 *
 * @param threadIds - 조회할 스레드 ID 목록
 * @param managerThreads - Manager 스레드 목록 (선택사항, 추가 컨텍스트 제공)
 *
 * @returns 상태 맵, 작업 계획 맵, 통계, 로딩 상태
 *
 * @example
 * ```tsx
 * const {
 *   statusMap,
 *   taskPlanMap,
 *   statusCounts,
 *   groupedThreads,
 *   isLoading,
 * } = useThreadsStatus(threadIds, managerThreads);
 *
 * // 실행 중인 스레드 개수
 * console.log(statusCounts.running);
 *
 * // 특정 스레드의 상태
 * const status = statusMap[threadId];
 *
 * // 완료된 스레드 목록
 * const completedThreads = groupedThreads.completed;
 * ```
 */
export function useThreadsStatus(
  threadIds: string[],
  managerThreads?: Thread<ManagerGraphState>[],
): UseThreadsStatusResult {
  const lastPollingStatesRef = useRef<Map<string, ThreadStatusData>>(new Map());

  // Create a stable key for the thread IDs array
  const sortedThreadIds = threadIds.sort();
  const threadIdsKey = sortedThreadIds.join(",");

  const swrKey =
    threadIds.length > 0
      ? threadIds.length <= 4
        ? `threads-status-batch-${threadIds.length}-${threadIdsKey}`
        : `threads-status-${threadIdsKey}`
      : null;

  const {
    data: fetchResult,
    isLoading,
    error,
  } = useSWR(
    swrKey,
    async () => {
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Status SWR] Fetching statuses for ${threadIds.length} threads`,
        );
      }

      const result = await fetchAllThreadStatuses(
        sortedThreadIds, // Use sorted array for consistency
        lastPollingStatesRef.current,
        managerThreads,
      );
      lastPollingStatesRef.current = result.updatedStates;
      return result;
    },
    THREAD_STATUS_SWR_CONFIG,
  );

  const statusMap = fetchResult?.statusMap || {};
  const taskPlanMap = fetchResult?.taskPlanMap || {};

  return useMemo(() => {
    const groupedThreads: GroupedThreadIds = {
      running: [],
      completed: [],
      failed: [],
      pending: [],
      idle: [],
      paused: [],
      error: [],
    };

    if (statusMap) {
      Object.entries(statusMap).forEach(([threadId, status]) => {
        if (groupedThreads[status]) {
          groupedThreads[status].push(threadId);
        }
      });
    }

    const statusCounts: ThreadStatusCounts = {
      all: threadIds.length,
      running: groupedThreads.running.length,
      completed: groupedThreads.completed.length,
      failed: groupedThreads.failed.length,
      pending: groupedThreads.pending.length,
      idle: groupedThreads.idle.length,
      paused: groupedThreads.paused.length,
      error: groupedThreads.error.length,
    };

    return {
      statusMap: statusMap || {},
      taskPlanMap: taskPlanMap || {},
      statusCounts,
      groupedThreads,
      isLoading,
      hasErrors: !!error,
    };
  }, [statusMap, taskPlanMap, threadIds, threadIdsKey, isLoading, error]);
}
