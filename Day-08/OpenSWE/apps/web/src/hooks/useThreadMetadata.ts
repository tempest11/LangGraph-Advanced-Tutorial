/**
 * @file useThreadMetadata.ts
 * @description
 * 스레드 메타데이터와 실시간 상태를 결합하는 커스텀 훅.
 * 스레드 기본 정보에 실시간 작업 계획과 상태를 병합하여 제공합니다.
 */

import { Thread } from "@langchain/langgraph-sdk";
import { ManagerGraphState } from "@openswe/shared/open-swe/manager/types";
import { ThreadMetadata } from "@/components/v2/types";
import { useThreadStatus } from "./useThreadStatus";
import { useMemo } from "react";
import { getThreadTitle, computeThreadTitle } from "@/lib/thread";
import { calculateLastActivity } from "@/lib/thread-utils";
import { ThreadStatusError } from "@/lib/schemas/thread-status";

/**
 * @hook useThreadMetadata
 * @description
 * 스레드 메타데이터를 실시간 상태와 결합하는 커스텀 훅.
 * LangGraph 스레드 데이터와 실시간 상태를 병합하여 UI에 필요한 메타데이터를 생성합니다.
 *
 * @features
 * - 스레드 제목, 저장소, 브랜치 정보 제공
 * - 실시간 작업 계획 및 상태 통합
 * - GitHub 이슈 정보 포함
 * - 마지막 활동 시간 계산
 *
 * @param thread - LangGraph 스레드 객체
 * @returns 메타데이터, 로딩 상태, 에러
 *
 * @example
 * ```tsx
 * const { metadata, isStatusLoading, statusError } = useThreadMetadata(thread);
 *
 * return (
 *   <div>
 *     <h1>{metadata.title}</h1>
 *     <p>Repository: {metadata.repository}</p>
 *     <p>Tasks: {metadata.taskCount}</p>
 *   </div>
 * );
 * ```
 */
export function useThreadMetadata(thread: Thread<ManagerGraphState>): {
  metadata: ThreadMetadata;
  isStatusLoading: boolean;
  statusError: Error | ThreadStatusError | null;
} {
  const {
    status,
    isLoading: isStatusLoading,
    error: statusError,
    taskPlan: realTimeTaskPlan,
  } = useThreadStatus(thread.thread_id);

  const metadata: ThreadMetadata = useMemo((): ThreadMetadata => {
    const values = thread.values;

    return {
      id: thread.thread_id,
      title: computeThreadTitle(realTimeTaskPlan, getThreadTitle(thread)),
      lastActivity: calculateLastActivity(thread.updated_at),
      taskCount: realTimeTaskPlan?.tasks.length ?? 0,
      repository: values?.targetRepository
        ? `${values.targetRepository.owner}/${values.targetRepository.repo}`
        : "",
      branch: values?.targetRepository?.branch || "main",
      taskPlan: realTimeTaskPlan,
      status,
      githubIssue: values?.githubIssueId
        ? {
            number: values?.githubIssueId,
            url: `https://github.com/${values?.targetRepository?.owner}/${values?.targetRepository?.repo}/issues/${values?.githubIssueId}`,
          }
        : undefined,
    };
  }, [thread, status, realTimeTaskPlan]);

  return {
    metadata,
    isStatusLoading,
    statusError,
  };
}
