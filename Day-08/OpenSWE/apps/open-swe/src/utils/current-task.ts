/**
 * @file current-task.ts
 * @description
 * 작업 계획(Plan)의 현재/완료/남은 작업 아이템을 추출하는 유틸리티 함수들을 제공합니다.
 * Planner와 Programmer 그래프에서 작업 진행 상황을 추적하고 관리하는 데 사용됩니다.
 *
 * 주요 기능:
 * - 현재 진행 중인 작업 조회
 * - 완료된 작업 목록 조회
 * - 남은 작업 목록 조회 (현재 작업 포함/제외 옵션)
 *
 * @example
 * const current = getCurrentPlanItem(plan);
 * const completed = getCompletedPlanItems(plan);
 * const remaining = getRemainingPlanItems(plan, false);
 */

import { PlanItem } from "@openswe/shared/open-swe/types";

/**
 * 주어진 계획에서 현재 진행 중인 작업 아이템을 반환합니다.
 *
 * @description
 * 완료되지 않은 작업들 중 index가 가장 작은 (가장 먼저 처리해야 할) 작업을 반환합니다.
 * 모든 작업이 완료되었거나 계획이 비어있는 경우, 기본 "작업 없음" 아이템을 반환합니다.
 *
 * @param plan - 작업 계획 아이템 배열
 * @returns 현재 진행 중인 작업 아이템 (없으면 기본 아이템)
 *
 * @example
 * const currentTask = getCurrentPlanItem(plan);
 * if (currentTask.index === -1) {
 *   console.log("모든 작업 완료!");
 * }
 */
export function getCurrentPlanItem(plan: PlanItem[]): PlanItem {
  return (
    plan.filter((p) => !p.completed).sort((a, b) => a.index - b.index)?.[0] || {
      plan: "No current task found.",
      index: -1,
      completed: true,
      summary: "",
    }
  );
}

/**
 * 주어진 계획에서 완료된 작업 아이템 목록을 반환합니다.
 *
 * @description
 * `completed` 플래그가 true인 모든 작업 아이템을 필터링하여 반환합니다.
 * 작업 진행 상황 요약이나 완료 보고서 생성에 사용됩니다.
 *
 * @param plan - 작업 계획 아이템 배열
 * @returns 완료된 작업 아이템 배열
 *
 * @example
 * const completedTasks = getCompletedPlanItems(plan);
 * console.log(`완료: ${completedTasks.length}개`);
 */
export function getCompletedPlanItems(plan: PlanItem[]): PlanItem[] {
  return plan.filter((p) => p.completed);
}

/**
 * 주어진 계획에서 남은 작업 아이템 목록을 반환합니다.
 *
 * @description
 * 완료되지 않은 작업들을 index 순서대로 정렬하여 반환합니다.
 * `includeCurrentPlanItem` 옵션으로 현재 진행 중인 작업을 포함할지 여부를 제어할 수 있습니다.
 *
 * 사용 예시:
 * - 다음 작업 목록 표시: includeCurrentPlanItem = false (기본값)
 * - 전체 미완료 작업 표시: includeCurrentPlanItem = true
 *
 * @param plan - 작업 계획 아이템 배열
 * @param includeCurrentPlanItem - 현재 작업을 결과에 포함할지 여부 (기본값: false)
 * @returns 남은 작업 아이템 배열 (index 오름차순)
 *
 * @example
 * // 다음 작업들만 조회
 * const nextTasks = getRemainingPlanItems(plan, false);
 *
 * // 현재 + 다음 작업 모두 조회
 * const allRemaining = getRemainingPlanItems(plan, true);
 */
export function getRemainingPlanItems(
  plan: PlanItem[],
  includeCurrentPlanItem = false,
): PlanItem[] {
  return plan
    .filter(
      (p) =>
        !p.completed &&
        (includeCurrentPlanItem || p.index !== getCurrentPlanItem(plan).index),
    )
    ?.sort((a, b) => a.index - b.index);
}
