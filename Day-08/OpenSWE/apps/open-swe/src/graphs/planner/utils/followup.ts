/**
 * @file Planner의 후속 요청(Followup) 프롬프트 포맷팅 유틸리티
 * @description
 * 사용자가 이전 세션의 결과를 기반으로 새로운 요청을 보냈을 때,
 * 이전 컨텍스트(완료된 작업, 제안된 계획, 스크래치패드 노트)를
 * LLM 프롬프트 형식으로 포맷팅하는 유틸리티 함수들을 제공합니다.
 *
 * 주요 기능:
 * 1. 이전 완료 작업 프롬프트 생성 (새 계획 생성 시)
 * 2. 제안된 계획 프롬프트 생성 (계획 수정 시)
 * 3. Followup 여부 판단
 *
 * 사용 사례:
 * - 사용자: "버그를 수정했어. 이제 테스트도 작성해줘" (새 계획)
 * - 사용자: "아니야, 먼저 리팩토링부터 해줘" (계획 수정)
 */

// Open SWE 공유 모듈
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks"; // 활성 계획 항목 추출 함수
import { TaskPlan } from "@openswe/shared/open-swe/types"; // 작업 계획 타입 정의

/**
 * 이전 완료 작업 프롬프트 템플릿
 *
 * @description
 * 모든 작업이 완료된 후 새로운 계획을 생성할 때 사용됩니다.
 * 이전 작업들의 요약과 스크래치패드 노트를 컨텍스트로 제공합니다.
 *
 * @constant {string}
 */
const previousCompletedPlanPrompt = `Here is the list of tasks from the previous session. You've already completed all of these tasks. Use the tasks, and task summaries as context when generating a new plan:
{PREVIOUS_PLAN}

Here are the notes you wrote to a scratchpad while gathering context for these tasks:
{SCRATCHPAD}`;

/**
 * 제안된 계획 프롬프트 템플릿
 *
 * @description
 * 사용자가 제안된 계획을 수정하거나 추가 요청을 보냈을 때 사용됩니다.
 * 기존 계획과 스크래치패드 노트를 컨텍스트로 제공합니다.
 *
 * @constant {string}
 */
const previousProposedPlanPrompt = `Here is the complete list of the proposed plan you generated before the user sent their followup request:
{PREVIOUS_PROPOSED_PLAN}

Here are the notes you wrote to a scratchpad while gathering context for these tasks:
{SCRATCHPAD}`;

/**
 * Followup 메시지 프롬프트 템플릿
 *
 * @description
 * 후속 요청에 대한 전체 지침을 제공합니다.
 * LLM에게 이전 컨텍스트를 참고하여 새 계획을 생성하거나
 * 기존 계획을 최소한으로 수정하도록 안내합니다.
 *
 * @constant {string}
 */
const followupMessagePrompt = `<followup_message_instructions>
The user is sending a followup request for you to generate a plan for. You are provided with the following context to aid in your new plan context gathering steps:
  - The previous user requests, along with the tasks, and task summaries you generated for these previous requests.
  - The summaries of the actions you took, and their results from previous planning sessions.
  - You are only provided this information as context to reference when gathering context for the new plan, or for making changes to the proposed plan.
  - If the user requests changes/additions to the proposed plan, your goal is to make as few changes/additions as possible, only addressing the specific changes the user requested.

{PREVIOUS_PLAN}
</followup_message_instructions>`;

/**
 * 이전 완료 작업들을 XML 형식으로 포맷팅합니다
 *
 * @description
 * 완료된 작업들의 요청, 요약, 개별 계획 항목들을 구조화된 XML로 변환합니다.
 * 각 작업은 인덱스와 함께 제공되며, 스크래치패드 노트도 포함됩니다.
 *
 * 출력 구조:
 * ```xml
 * <previous-task index="1">
 *   User request: 사용자 요청
 *   Overall task summary: 전체 작업 요약
 *   Individual tasks & their summaries:
 *     <plan-item index="1">
 *       Plan: 계획 내용
 *       Summary: 실행 요약
 *     </plan-item>
 * </previous-task>
 * ```
 *
 * @param {TaskPlan} tasks - 완료된 작업 계획 객체
 * @param {string} [scratchpad] - 스크래치패드 노트 (선택사항)
 * @returns {string} XML 형식으로 포맷팅된 이전 작업 프롬프트
 */
const formatPreviousPlans = (tasks: TaskPlan, scratchpad?: string): string => {
  // === 각 작업을 XML로 포맷팅 ===
  const formattedTasksAndRequests = tasks.tasks
    .map((task) => {
      // 활성 리비전의 계획 항목들 가져오기
      const activePlanItems =
        task.planRevisions[task.activeRevisionIndex].plans;

      return `<previous-task index="${task.taskIndex}">
  User request: ${task.request}

  Overall task summary:\n</task-summary>\n${task.summary || "No overall task summary found"}\n</task-summary>

  Individual tasks & their summaries you generated to complete this request:
${activePlanItems
  .map(
    (planItem) => `
  <plan-item index="${planItem.index}">
    Plan: ${planItem.plan}
    Summary: ${planItem.summary || "No summary found for this task."}
  </plan-item>`,
  )
  .join("\n  ")}
</previous-task>`;
    })
    .join("\n");

  // === 템플릿에 데이터 삽입 ===
  return previousCompletedPlanPrompt
    .replace("{PREVIOUS_PLAN}", formattedTasksAndRequests)
    .replace("{SCRATCHPAD}", scratchpad || "");
};

/**
 * 제안된 계획을 XML 형식으로 포맷팅합니다
 *
 * @description
 * 사용자 승인을 기다리는 중에 받은 후속 요청을 처리하기 위해,
 * 제안된 계획 항목들을 구조화된 XML로 변환합니다.
 *
 * 출력 구조:
 * ```xml
 * <proposed-plan-item>계획 항목 1</proposed-plan-item>
 * <proposed-plan-item>계획 항목 2</proposed-plan-item>
 * ```
 *
 * @param {string[]} proposedPlan - 제안된 계획 항목 배열
 * @param {string} [scratchpad] - 스크래치패드 노트 (선택사항)
 * @returns {string} XML 형식으로 포맷팅된 제안 계획 프롬프트
 */
const formatPreviousProposedPlan = (
  proposedPlan: string[],
  scratchpad?: string,
): string => {
  // === 각 계획 항목을 XML 태그로 감싸기 ===
  const formattedProposedPlan = proposedPlan
    .map((p) => `<proposed-plan-item>${p}</proposed-plan-item>`)
    .join("\n");

  // === 템플릿에 데이터 삽입 ===
  return previousProposedPlanPrompt
    .replace("{PREVIOUS_PROPOSED_PLAN}", formattedProposedPlan)
    .replace("{SCRATCHPAD}", scratchpad || "");
};

/**
 * Followup 메시지에 대한 전체 프롬프트를 생성합니다
 *
 * @description
 * 현재 상태를 분석하여 적절한 프롬프트를 선택합니다:
 * - 모든 작업 완료 → 새 계획 생성 프롬프트
 * - 작업 진행 중 or 계획 제안됨 → 계획 수정 프롬프트
 *
 * 처리 흐름:
 * 1. 활성 계획 항목들을 가져와 완료 여부 확인
 * 2. 모두 완료되었으면 새 계획 생성 모드
 * 3. 그렇지 않으면 계획 수정 모드 (제안 계획 필요)
 * 4. 적절한 포맷팅 함수로 프롬프트 생성
 *
 * @param {TaskPlan} tasks - 현재 작업 계획 객체
 * @param {string[]} proposedPlan - 제안된 계획 배열
 * @param {string} [scratchpad] - 스크래치패드 노트 (선택사항)
 * @returns {string} 완성된 followup 프롬프트
 * @throws {Error} 계획 수정 모드인데 제안 계획이 없을 때
 *
 * @example
 * // 새 계획 생성 (모든 작업 완료)
 * const prompt1 = formatFollowupMessagePrompt(
 *   { tasks: [{ completed: true, ... }] },
 *   [],
 *   "기존 작업 노트..."
 * );
 *
 * @example
 * // 계획 수정 (제안 계획 존재)
 * const prompt2 = formatFollowupMessagePrompt(
 *   { tasks: [] },
 *   ["계획 항목 1", "계획 항목 2"],
 *   "컨텍스트 노트..."
 * );
 */
export function formatFollowupMessagePrompt(
  tasks: TaskPlan,
  proposedPlan: string[],
  scratchpad?: string,
): string {
  // === 1단계: 새 계획 생성 여부 판단 ===
  let isGeneratingNewPlan = false;
  if (tasks && tasks.tasks?.length) {
    const activePlanItems = getActivePlanItems(tasks);
    // 모든 활성 계획이 완료되었는지 확인
    isGeneratingNewPlan = activePlanItems.every((p) => p.completed);

    // 계획 수정 모드인데 제안 계획이 없으면 에러
    if (!isGeneratingNewPlan && !proposedPlan.length) {
      throw new Error(
        "Can not format plan prompt if no proposed plan is provided.",
      );
    }
  }

  // === 2단계: 적절한 프롬프트 생성 ===
  return followupMessagePrompt.replace(
    "{PREVIOUS_PLAN}",
    isGeneratingNewPlan
      ? formatPreviousPlans(tasks, scratchpad) // 새 계획 생성
      : formatPreviousProposedPlan(proposedPlan, scratchpad), // 계획 수정
  );
}

/**
 * 현재 요청이 followup 요청인지 판단합니다
 *
 * @description
 * 다음 조건 중 하나라도 만족하면 followup 요청으로 판단합니다:
 * - 이전 작업들이 존재함 (tasks.tasks.length > 0)
 * - 제안된 계획이 존재함 (proposedPlan.length > 0)
 *
 * @param {TaskPlan | undefined} taskPlan - 작업 계획 객체 (없을 수 있음)
 * @param {string[] | undefined} proposedPlan - 제안 계획 배열 (없을 수 있음)
 * @returns {boolean} followup 요청 여부
 *
 * @example
 * isFollowupRequest(undefined, undefined); // false (최초 요청)
 * isFollowupRequest({ tasks: [...] }, []); // true (이전 작업 존재)
 * isFollowupRequest(undefined, ["계획"]); // true (제안 계획 존재)
 */
export function isFollowupRequest(
  taskPlan: TaskPlan | undefined,
  proposedPlan: string[] | undefined,
) {
  return taskPlan?.tasks?.length || proposedPlan?.length;
}
