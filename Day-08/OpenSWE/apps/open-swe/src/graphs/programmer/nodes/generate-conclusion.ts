/**
 * @file Programmer의 최종 결론 생성 노드
 * @description
 * 모든 계획 항목이 완료된 후 LLM을 사용하여 작업 요약 및 최종 결론을 생성하는 노드입니다.
 * 작업 완료 후 사용자에게 제공할 간결한 요약을 만들고, GitHub 이슈를 업데이트합니다.
 *
 * 주요 기능:
 * - LLM을 사용하여 작업 완료 요약 생성
 * - 작업 계획(TaskPlan)에 요약 저장
 * - GitHub 이슈에 완료 정보 업데이트 (클라우드 모드)
 * - 실행 모드에 따른 라우팅 (로컬 모드 → END, 샌드박스 모드 → open-pr)
 *
 * 워크플로우:
 * 1. 완료된 작업들을 포함한 프롬프트 구성
 * 2. LLM 호출로 간결한 결론 생성
 * 3. TaskPlan 업데이트 (작업 완료 + 요약 저장)
 * 4. GitHub 이슈 업데이트 (클라우드 모드만)
 * 5. 모드에 따라 라우팅 (로컬: 종료, 샌드박스: PR 생성)
 */

// Open SWE 공유 타입
import {
  GraphConfig, // LangGraph 설정 타입
  GraphState, // 그래프 전역 상태 타입
  GraphUpdate, // 상태 업데이트 타입
  PlanItem, // 개별 계획 항목 타입
} from "@openswe/shared/open-swe/types";

// 유틸리티 함수들
import { loadModel } from "../../../utils/llms/index.js"; // LLM 모델 로더
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (SUMMARIZER)
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 내용 추출
import { getMessageString } from "../../../utils/message/content.js"; // 메시지 문자열 변환
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
import { formatUserRequestPrompt } from "../../../utils/user-request.js"; // 사용자 요청 프롬프트 포맷팅
import {
  completeTask, // 작업 완료 처리
  getActivePlanItems, // 활성 계획 항목 추출
  getActiveTask, // 현재 활성 작업 가져오기
} from "@openswe/shared/open-swe/tasks";
import { addTaskPlanToIssue } from "../../../utils/github/issue-task.js"; // GitHub 이슈 업데이트
import { trackCachePerformance } from "../../../utils/caching.js"; // 캐싱 성능 추적
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 관리자
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 확인
import { Command, END } from "@langchain/langgraph"; // LangGraph 라우팅

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "GenerateConclusionNode");

/**
 * 결론 생성을 위한 시스템 프롬프트
 *
 * @description
 * LLM에게 완료된 작업들을 제공하고 간결한 결론을 생성하도록 요청하는 템플릿입니다.
 * 사용자에게 변경 사항, 추가 단계, 관련 정보를 명확히 전달하도록 안내합니다.
 *
 * @constant {string}
 */
const prompt = `You are operating as a terminal-based agentic coding assistant built by LangChain. It wraps LLM models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You have just completed all of the tasks in the plan:
{COMPLETED_TASKS}

Since you've successfully completed the user's request, you should now generate a short, concise concision. It can be helpful here to outline all of the changes you've made to the codebase, any additional steps you think the user should take, any relevant informatioon from the conversation hostiry below, etc.
Your concision message should be concise and to the point, you do NOT want to include any details which are not ABSOLUTELY NECESSARY.
`;

/**
 * 완료된 작업 목록을 프롬프트에 삽입합니다
 *
 * @description
 * TaskPlan의 각 항목을 "인덱스. 계획" 형식으로 포맷팅하여
 * {COMPLETED_TASKS} 플레이스홀더를 대체합니다.
 *
 * @param {PlanItem[]} taskPlan - 완료된 계획 항목 배열
 * @returns {string} 포맷팅된 시스템 프롬프트
 *
 * @example
 * formatPrompt([
 *   { index: 1, plan: "파일 읽기" },
 *   { index: 2, plan: "버그 수정" }
 * ]);
 * // => "1. 파일 읽기\n2. 버그 수정"
 */
const formatPrompt = (taskPlan: PlanItem[]): string => {
  return prompt.replace(
    "{COMPLETED_TASKS}",
    taskPlan.map((p) => `${p.index}. ${p.plan}`).join("\n"),
  );
};

/**
 * 작업 완료 후 최종 결론을 생성하는 노드 함수입니다
 *
 * @description
 * 모든 계획 항목이 완료되면 호출되며, LLM을 사용하여 간결한 요약을 생성합니다.
 * 생성된 요약은 TaskPlan에 저장되고, GitHub 이슈도 업데이트됩니다.
 *
 * 처리 흐름:
 * 1. SUMMARIZER 타입의 LLM 모델 로드
 * 2. 사용자 요청 및 대화 기록 포맷팅
 * 3. LLM 호출하여 결론 생성
 * 4. TaskPlan에 작업 완료 및 요약 저장
 * 5. GitHub 이슈 업데이트 (클라우드 모드만)
 * 6. 모드에 따라 라우팅:
 *    - 로컬 모드: END (종료)
 *    - 샌드박스 모드: "open-pr" (PR 생성 노드로)
 *
 * @param {GraphState} state - 현재 그래프 상태 (TaskPlan, 메시지, GitHub 정보 포함)
 * @param {GraphConfig} config - 그래프 설정 (모델 설정, 모드 정보 등)
 * @returns {Promise<Command>} 상태 업데이트 및 다음 노드 라우팅 명령
 *
 * @example
 * // 로컬 모드에서 호출 시
 * const command = await generateConclusion(state, config);
 * // => Command { update: {...}, goto: END }
 *
 * @example
 * // 샌드박스 모드에서 호출 시
 * const command = await generateConclusion(state, config);
 * // => Command { update: {...}, goto: "open-pr" }
 */
export async function generateConclusion(
  state: GraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.SUMMARIZER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(
    config,
    LLMTask.SUMMARIZER,
  );

  // === 2단계: 사용자 메시지 구성 ===
  // 원래 사용자 요청 포맷팅
  const userRequestPrompt = formatUserRequestPrompt(state.messages);

  // 전체 대화 기록 포함한 사용자 메시지
  const userMessage = `${userRequestPrompt}

The full conversation history is as follows:
${state.internalMessages.map(getMessageString).join("\n")}

Given all of this, please respond with the concise conclusion. Do not include any additional text besides the conclusion.`;

  logger.info("Generating conclusion");

  // === 3단계: LLM 호출하여 결론 생성 ===
  const response = await model.invoke([
    {
      role: "system",
      content: formatPrompt(getActivePlanItems(state.taskPlan)),
    },
    {
      role: "user",
      content: userMessage,
    },
  ]);

  logger.info("✅ Successfully generated conclusion.");

  // === 4단계: TaskPlan 업데이트 ===
  // 현재 활성 작업을 완료 상태로 변경하고 요약 저장
  const activeTaskId = getActiveTask(state.taskPlan).id;
  const updatedTaskPlan = completeTask(
    state.taskPlan,
    activeTaskId,
    getMessageContentString(response.content),
  );

  // === 5단계: GitHub 이슈 업데이트 (클라우드 모드만) ===
  // 로컬 모드에서는 GitHub API 호출 스킵
  if (!isLocalMode(config) && state.githubIssueId) {
    await addTaskPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      updatedTaskPlan,
    );
  }

  // === 6단계: 상태 업데이트 객체 생성 ===
  const graphUpdate: GraphUpdate = {
    messages: [response], // 사용자에게 보여줄 메시지
    internalMessages: [response], // 내부 대화 기록
    taskPlan: updatedTaskPlan, // 업데이트된 작업 계획
    tokenData: trackCachePerformance(response, modelName), // 캐싱 성능 데이터
  };

  // === 7단계: 실행 모드에 따른 라우팅 ===
  // 로컬 모드: 바로 종료 (PR 생성 없음)
  if (isLocalMode(config)) {
    logger.info("Local mode: routing to END");
    return new Command({
      update: graphUpdate,
      goto: END,
    });
  } else {
    // 샌드박스 모드: PR 생성 노드로 이동
    logger.info("Sandbox mode: routing to open-pr");
    return new Command({
      update: graphUpdate,
      goto: "open-pr",
    });
  }
}
