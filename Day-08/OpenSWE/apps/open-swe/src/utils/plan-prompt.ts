/**
 * @file plan-prompt.ts
 * @description
 * 작업 계획(Plan)을 LLM 프롬프트 형식으로 포맷팅하는 유틸리티 함수들을 제공합니다.
 * Planner와 Programmer 그래프에서 현재/완료/남은 작업을 구조화된 XML 태그로 변환하여
 * LLM에게 전달할 수 있도록 합니다.
 *
 * 주요 기능:
 * - 작업 계획을 XML 형식의 프롬프트로 변환
 * - 완료/남은/현재 작업 구분
 * - 작업 요약(summary) 포함 옵션
 *
 * @example
 * const prompt = formatPlanPrompt(plan, { includeSummaries: true });
 */

import { PlanItem } from "@openswe/shared/open-swe/types";

/**
 * 작업 계획 프롬프트 템플릿입니다.
 * LLM에게 작업 상황을 전달하기 위한 XML 형식의 템플릿입니다.
 */
export const PLAN_PROMPT = `<completed_tasks>
  {COMPLETED_TASKS}
</completed_tasks>

<remaining_tasks>
  (This list does not include the current task)
  {REMAINING_TASKS}
</remaining_tasks>

  {CURRENT_TASK}
`;

/**
 * 작업 계획을 프롬프트 형식으로 포맷팅합니다.
 *
 * @description
 * PlanItem 배열을 받아 완료/남은/현재 작업을 구분하고, PLAN_PROMPT 템플릿에
 * XML 형식으로 채워 넣어 LLM이 이해할 수 있는 구조화된 문자열을 반환합니다.
 *
 * 처리 로직:
 * 1. 완료/남은 작업 분류
 * 2. 현재 작업 선택 (옵션에 따라 마지막 완료 작업 또는 첫 번째 남은 작업)
 * 3. 각 섹션을 XML 태그로 포맷팅
 * 4. PLAN_PROMPT 템플릿의 placeholder 치환
 *
 * @param taskPlan - 포맷팅할 작업 계획 배열
 * @param options - 포맷팅 옵션
 * @param options.useLastCompletedTask - 마지막 완료 작업을 현재 작업으로 사용할지 여부
 * @param options.includeSummaries - 완료된 작업의 요약을 포함할지 여부
 * @returns XML 형식으로 포맷팅된 작업 계획 문자열
 *
 * @example
 * const prompt = formatPlanPrompt(plan, {
 *   useLastCompletedTask: false,
 *   includeSummaries: true
 * });
 */
export function formatPlanPrompt(
  taskPlan: PlanItem[],
  options?: {
    useLastCompletedTask?: boolean;
    includeSummaries?: boolean;
  },
): string {
  let completedTasks = taskPlan.filter((p) => p.completed);
  let remainingTasks = taskPlan.filter((p) => !p.completed);
  let currentTask: PlanItem | undefined;
  if (options?.useLastCompletedTask) {
    currentTask = completedTasks.sort((a, b) => a.index - b.index)[0];
    // Remove the current task from the completed tasks list:
    completedTasks = completedTasks.filter(
      (p) => p.index !== currentTask?.index,
    );
  } else {
    currentTask = remainingTasks.sort((a, b) => a.index - b.index)[0];
    // Remove the current task from the remaining tasks list:
    remainingTasks = remainingTasks.filter(
      (p) => p.index !== currentTask?.index,
    );
  }

  return PLAN_PROMPT.replace(
    "{COMPLETED_TASKS}",
    completedTasks?.length
      ? options?.includeSummaries
        ? formatPlanPromptWithSummaries(completedTasks)
        : completedTasks
            .map(
              (task) =>
                `<completed_task index="${task.index}">\n${task.plan}\n</completed_task>`,
            )
            .join("\n")
      : "No completed tasks.",
  )
    .replace(
      "{REMAINING_TASKS}",
      remainingTasks?.length
        ? remainingTasks
            .map(
              (task) =>
                `<remaining_task index="${task.index}">\n${task.plan}\n</remaining_task>`,
            )
            .join("\n")
        : "No remaining tasks.",
    )
    .replace(
      "{CURRENT_TASK}",
      `<current_task index="${currentTask?.index}">\n${currentTask?.plan || "No current task found."}\n</current_task>`,
    );
}

/**
 * 작업 계획을 요약(summary)과 함께 XML 형식으로 포맷팅합니다.
 *
 * @description
 * 각 작업 아이템을 `<task>` 또는 `<completed_task>` 태그로 감싸고,
 * 내부에 `<task_summary>` 태그를 추가하여 작업 요약을 함께 표시합니다.
 * 작업의 완료 여부에 따라 태그 이름이 변경됩니다.
 *
 * 출력 형식:
 * ```xml
 * <completed_task index="1">
 *   작업 설명
 *   <task_summary>
 *     작업 요약
 *   </task_summary>
 * </completed_task>
 * ```
 *
 * @param taskPlan - 포맷팅할 작업 계획 배열
 * @returns 요약이 포함된 XML 형식의 작업 목록 문자열
 *
 * @example
 * const formattedWithSummaries = formatPlanPromptWithSummaries(completedTasks);
 */
export function formatPlanPromptWithSummaries(taskPlan: PlanItem[]): string {
  return taskPlan
    .map(
      (p) =>
        `<${p.completed ? "completed_" : ""}task index="${p.index}">\n${p.plan}\n  <task_summary>\n${p.summary || "No task summary found"}\n  </task_summary>\n</${p.completed ? "completed_" : ""}task>`,
    )
    .join("\n");
}
