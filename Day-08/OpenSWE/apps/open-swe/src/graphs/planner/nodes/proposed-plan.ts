/**
 * @file Planner 계획 승인 인터럽트 노드
 * @description
 * 생성된 계획을 사용자에게 제시하고 승인/수정/응답/무시를 받는 인터럽트 노드입니다.
 * 승인 시 Programmer 그래프를 시작하여 계획을 실행합니다.
 *
 * 주요 기능:
 * 1. 계획을 GitHub 이슈에 게시
 * 2. 사용자 인터럽트 (승인/수정/응답/무시)
 * 3. 승인/수정 시 Programmer 그래프 시작
 * 4. 응답 시 컨텍스트 수집으로 돌아가기
 * 5. 무시 시 종료
 * 6. 자동 승인 모드 지원
 *
 * 처리 흐름:
 * 1. 자동 승인 모드 체크
 *    - 활성화: 바로 Programmer 시작
 * 2. 계획을 GitHub 이슈에 게시
 * 3. 사용자 인터럽트 대기
 * 4. 사용자 응답에 따라 분기:
 *    - accept: Programmer 시작
 *    - edit: 수정된 계획으로 Programmer 시작
 *    - response: 컨텍스트 수집으로 돌아가기
 *    - ignore: 종료
 */

// === UUID ===
import { v4 as uuidv4 } from "uuid"; // 고유 ID 생성

// === LangChain 메시지 ===
import { AIMessage, BaseMessage } from "@langchain/core/messages"; // 메시지 타입

// === LangGraph ===
import { Command, END, interrupt } from "@langchain/langgraph"; // Command, 종료, 인터럽트
import { StreamMode } from "@langchain/langgraph-sdk"; // 스트리밍 모드
import {
  ActionRequest, // 액션 요청 타입
  HumanInterrupt, // 사람 인터럽트 타입
  HumanResponse, // 사람 응답 타입
} from "@langchain/langgraph/prebuilt";

// === 타입 정의 ===
import {
  GraphUpdate, // 그래프 업데이트 타입
  GraphConfig, // LangGraph 설정 객체
  TaskPlan, // 태스크 계획 타입
  PlanItem, // 계획 항목 타입
} from "@openswe/shared/open-swe/types";
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types"; // Planner 그래프 상태 타입

// === 샌드박스 ===
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js"; // 에러 처리가 포함된 샌드박스 조회

// === 태스크 생성 ===
import { createNewTask } from "@openswe/shared/open-swe/tasks"; // 새 태스크 생성

// === 사용자 요청 ===
import {
  getInitialUserRequest, // 최초 사용자 요청 추출
  getRecentUserRequest, // 최근 사용자 요청 추출
} from "../../../utils/user-request.js";

// === 상수 ===
import {
  PLAN_INTERRUPT_ACTION_TITLE, // 계획 인터럽트 액션 제목
  PLAN_INTERRUPT_DELIMITER, // 계획 항목 구분자
  DO_NOT_RENDER_ID_PREFIX, // 렌더링 제외 메시지 ID 접두사
  PROGRAMMER_GRAPH_ID, // Programmer 그래프 ID
  OPEN_SWE_STREAM_MODE, // Open SWE 스트리밍 모드
  LOCAL_MODE_HEADER, // 로컬 모드 헤더
  GITHUB_INSTALLATION_ID, // GitHub 설치 ID 헤더
  GITHUB_INSTALLATION_TOKEN_COOKIE, // GitHub 설치 토큰 쿠키
  GITHUB_PAT, // GitHub Personal Access Token 헤더
} from "@openswe/shared/constants";

// === LangGraph 클라이언트 ===
import { createLangGraphClient } from "../../../utils/langgraph-client.js"; // LangGraph 클라이언트 생성

// === GitHub 이슈 ===
import {
  addProposedPlanToIssue, // 제안된 계획을 이슈에 추가
  addTaskPlanToIssue, // 태스크 계획을 이슈에 추가
} from "../../../utils/github/issue-task.js";
import {
  postGitHubIssueComment, // 이슈에 댓글 게시
  cleanTaskItems, // 태스크 항목 정리 (마크다운 형식)
} from "../../../utils/github/plan.js";
import { regenerateInstallationToken } from "../../../utils/github/regenerate-token.js"; // GitHub 설치 토큰 재생성

// === 로깅 ===
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 구조화된 로거

// === 커스텀 노드 이벤트 ===
import {
  ACCEPTED_PLAN_NODE_ID, // 계획 승인 노드 ID
  CustomNodeEvent, // 커스텀 노드 이벤트 타입
} from "@openswe/shared/open-swe/custom-node-events";

// === 기타 유틸리티 ===
import { getDefaultHeaders } from "../../../utils/default-headers.js"; // 기본 헤더 가져오기
import { getCustomConfigurableFields } from "@openswe/shared/open-swe/utils/config"; // 커스텀 설정 필드
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 여부 확인
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // 이슈 생성이 필요한지 확인

// === 로거 인스턴스 ===
const logger = createLogger(LogLevel.INFO, "ProposedPlan");

/**
 * 계획 승인 메시지 생성 함수
 *
 * @description
 * 계획이 승인/수정되었음을 나타내는 CustomNodeEvent를 포함한 AIMessage를 생성합니다.
 * 이 메시지는 프론트엔드에서 계획 승인 상태를 표시하는 데 사용됩니다.
 *
 * @param {Object} input - 입력 파라미터
 * @param {string} input.planTitle - 계획 제목
 * @param {PlanItem[]} input.planItems - 계획 항목들
 * @param {HumanResponse["type"]} input.interruptType - 인터럽트 응답 타입 (accept/edit)
 * @param {string} input.runId - 실행 ID
 * @returns {AIMessage} 계획 승인 메시지
 */
function createAcceptedPlanMessage(input: {
  planTitle: string;
  planItems: PlanItem[];
  interruptType: HumanResponse["type"];
  runId: string;
}) {
  const { planTitle, planItems, interruptType, runId } = input;

  const acceptedPlanEvent: CustomNodeEvent = {
    nodeId: ACCEPTED_PLAN_NODE_ID,
    actionId: uuidv4(),
    action: "Plan accepted",
    createdAt: new Date().toISOString(),
    data: {
      status: "success",
      planTitle,
      planItems,
      interruptType,
      runId,
    },
  };

  const acceptedPlanMessage = new AIMessage({
    id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
    content: "Accepted plan",
    additional_kwargs: {
      hidden: true,
      customNodeEvents: [acceptedPlanEvent],
    },
  });

  return acceptedPlanMessage;
}

/**
 * Programmer 그래프 실행 시작 함수
 *
 * @description
 * 계획이 승인/수정되면 Programmer 그래프를 시작하여 계획을 실행합니다.
 *
 * 처리 흐름:
 * 1. 로컬 모드 여부 확인 및 헤더 설정
 * 2. GitHub 설치 토큰 재생성 (클라우드 모드, PAT 없을 때)
 * 3. LangGraph 클라이언트 생성
 * 4. 샌드박스 재시작
 * 5. Programmer 그래프 실행 생성 (스트리밍 활성화)
 * 6. GitHub 이슈에 태스크 계획 추가
 * 7. Planner 종료 (Programmer는 별도 스레드에서 실행)
 *
 * @param {Object} input - 입력 파라미터
 * @param {GraphUpdate & { taskPlan: TaskPlan }} input.runInput - Programmer 실행 입력
 * @param {PlannerGraphState} input.state - Planner 그래프 상태
 * @param {GraphConfig} input.config - LangGraph 설정
 * @param {BaseMessage[]} [input.newMessages] - 추가할 메시지들
 * @returns {Promise<Command>} END로 이동하는 Command (Programmer는 별도 실행)
 */
async function startProgrammerRun(input: {
  runInput: Exclude<GraphUpdate, "taskPlan"> & { taskPlan: TaskPlan };
  state: PlannerGraphState;
  config: GraphConfig;
  newMessages?: BaseMessage[];
}) {
  const { runInput, state, config, newMessages } = input;

  // === 1단계: 헤더 설정 ===
  const isLocal = isLocalMode(config);
  const defaultHeaders = isLocal
    ? { [LOCAL_MODE_HEADER]: "true" }
    : getDefaultHeaders(config);

  // === 2단계: GitHub 설치 토큰 재생성 ===
  // 로컬 모드가 아니고, GitHub PAT가 없을 때만 재생성
  // (GitHub PAT가 있으면 평가 모드이므로 재생성 불필요)
  if (!isLocal && !(GITHUB_PAT in defaultHeaders)) {
    logger.info(
      "Regenerating installation token before starting programmer run.",
    );
    defaultHeaders[GITHUB_INSTALLATION_TOKEN_COOKIE] =
      await regenerateInstallationToken(defaultHeaders[GITHUB_INSTALLATION_ID]);
    logger.info(
      "Regenerated installation token before starting programmer run.",
    );
  }

  // === 3단계: LangGraph 클라이언트 생성 ===
  const langGraphClient = createLangGraphClient({
    defaultHeaders,
  });

  // === 4단계: 샌드박스 재시작 ===
  const programmerThreadId = uuidv4();
  const { sandbox, codebaseTree, dependenciesInstalled } =
    await getSandboxWithErrorHandling(
      state.sandboxSessionId,
      state.targetRepository,
      state.branchName,
      config,
    );

  // 재시작된 샌드박스 정보로 업데이트
  runInput.sandboxSessionId = sandbox.id;
  runInput.codebaseTree = codebaseTree ?? runInput.codebaseTree;
  runInput.dependenciesInstalled =
    dependenciesInstalled !== null
      ? dependenciesInstalled
      : runInput.dependenciesInstalled;

  // === 5단계: Programmer 그래프 실행 생성 ===
  const run = await langGraphClient.runs.create(
    programmerThreadId,
    PROGRAMMER_GRAPH_ID,
    {
      input: runInput,
      config: {
        recursion_limit: 400, // 최대 재귀 깊이
        configurable: {
          ...getCustomConfigurableFields(config),
          ...(isLocalMode(config) && { [LOCAL_MODE_HEADER]: "true" }),
        },
      },
      ifNotExists: "create", // 스레드가 없으면 생성
      streamResumable: true, // 재개 가능한 스트리밍
      streamSubgraphs: true, // 서브 그래프 스트리밍
      streamMode: OPEN_SWE_STREAM_MODE as StreamMode[], // 스트리밍 모드
    },
  );

  // === 6단계: GitHub 이슈에 태스크 계획 추가 ===
  if (!isLocalMode(config) && shouldCreateIssue(config)) {
    await addTaskPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      runInput.taskPlan,
    );
  }

  // === 7단계: Planner 종료 ===
  // Programmer는 별도 스레드에서 계속 실행됨
  return new Command({
    goto: END,
    update: {
      programmerSession: {
        threadId: programmerThreadId,
        runId: run.run_id,
      },
      sandboxSessionId: runInput.sandboxSessionId,
      taskPlan: runInput.taskPlan,
      messages: newMessages,
    },
  });
}

/**
 * Planner 계획 승인 인터럽트 노드
 *
 * @description
 * 생성된 계획을 사용자에게 제시하고 승인/수정/응답/무시를 받습니다.
 * 승인/수정 시 Programmer 그래프를 시작하여 계획을 실행합니다.
 *
 * 처리 흐름:
 * 1. 자동 승인 모드 체크
 *    - 활성화: GitHub 댓글 게시 → Programmer 시작
 * 2. 계획을 GitHub 이슈에 게시
 * 3. 사용자 인터럽트 대기 (승인/수정/응답/무시)
 * 4. 사용자 응답에 따라 분기:
 *    - accept: GitHub 댓글 업데이트 → Programmer 시작
 *    - edit: 수정된 계획으로 GitHub 댓글 업데이트 → Programmer 시작
 *    - response: 컨텍스트 수집으로 돌아가기 (determine-needs-context)
 *    - ignore: 종료
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<Command>} 다음 노드로 이동하는 Command
 *   - goto: END (Programmer 시작) / determine-needs-context (응답) / END (무시)
 * @throws {Error} 제안된 계획이 없을 때
 * @throws {Error} 알 수 없는 인터럽트 타입일 때
 *
 * @example
 * // 자동 승인 모드:
 * // → GitHub 댓글 게시 → Programmer 시작
 *
 * // 수동 승인 모드:
 * // 1. GitHub 댓글 게시 (계획 제시)
 * // 2. 사용자 인터럽트 대기
 * // 3. 사용자 승인 → GitHub 댓글 업데이트 → Programmer 시작
 */
export async function interruptProposedPlan(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<Command> {
  const { proposedPlan } = state;

  // === 1단계: 제안된 계획 검증 ===
  if (!proposedPlan.length) {
    throw new Error("No proposed plan found.");
  }

  logger.info("Interrupting proposed plan", {
    autoAcceptPlan: state.autoAcceptPlan,
    isLocalMode: isLocalMode(config),
    proposedPlanLength: proposedPlan.length,
    proposedPlanTitle: state.proposedPlanTitle,
  });

  // === 2단계: Programmer 실행 입력 준비 ===
  let planItems: PlanItem[];
  const userRequest = getInitialUserRequest(state.messages);
  const userFollowupRequest = getRecentUserRequest(state.messages);
  const userTaskRequest = userFollowupRequest || userRequest;

  const runInput: GraphUpdate = {
    contextGatheringNotes: state.contextGatheringNotes,
    branchName: state.branchName,
    targetRepository: state.targetRepository,
    githubIssueId: state.githubIssueId,
    internalMessages: state.messages,
    documentCache: state.documentCache,
  };

  // === 3단계: 자동 승인 모드 처리 ===
  if (state.autoAcceptPlan) {
    logger.info("Auto accepting plan.", {
      autoAcceptPlan: state.autoAcceptPlan,
      isLocalMode: isLocalMode(config),
    });

    // GitHub 이슈에 자동 승인 댓글 게시 (로컬 모드 아닐 때)
    if (!isLocalMode(config) && state.githubIssueId) {
      await postGitHubIssueComment({
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
        commentBody: `### 🤖 Plan Generated\n\nI've generated a plan for this issue and will proceed to implement it since auto-accept is enabled.\n\n**Plan: ${state.proposedPlanTitle}**\n\n${proposedPlan.map((step, index) => `- Task ${index + 1}:\n${cleanTaskItems(step)}`).join("\n")}\n\nProceeding to implementation...`,
        config,
      });
    }

    // 계획 항목 생성 및 태스크 계획 생성
    planItems = proposedPlan.map((p, index) => ({
      index,
      plan: p,
      completed: false,
    }));

    runInput.taskPlan = createNewTask(
      userTaskRequest,
      state.proposedPlanTitle,
      planItems,
      { existingTaskPlan: state.taskPlan },
    );

    // Programmer 시작
    return await startProgrammerRun({
      runInput: runInput as Exclude<GraphUpdate, "taskPlan"> & {
        taskPlan: TaskPlan;
      },
      state,
      config,
      newMessages: [
        createAcceptedPlanMessage({
          planTitle: state.proposedPlanTitle,
          planItems,
          interruptType: "accept",
          runId: config.configurable?.run_id ?? "",
        }),
      ],
    });
  }

  // === 4단계: 수동 승인 모드 - GitHub 이슈에 계획 게시 ===
  if (!isLocalMode(config) && state.githubIssueId) {
    // 제안된 계획을 이슈에 추가 (구조화된 형식)
    await addProposedPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      proposedPlan,
    );

    // 계획 승인 요청 댓글 게시
    await postGitHubIssueComment({
      githubIssueId: state.githubIssueId,
      targetRepository: state.targetRepository,
      commentBody: `### 🟠 Plan Ready for Approval 🟠\n\nI've generated a plan for this issue and it's ready for your review.\n\n**Plan: ${state.proposedPlanTitle}**\n\n${proposedPlan.map((step, index) => `- Task ${index + 1}:\n${cleanTaskItems(step)}`).join("\n")}\n\nPlease review the plan and let me know if you'd like me to proceed, make changes, or if you have any feedback.`,
      config,
    });
  }

  // === 5단계: 사용자 인터럽트 대기 ===
  const interruptResponse = interrupt<
    HumanInterrupt,
    HumanResponse[] | HumanResponse
  >({
    action_request: {
      action: PLAN_INTERRUPT_ACTION_TITLE,
      args: {
        plan: proposedPlan.join(`\n${PLAN_INTERRUPT_DELIMITER}\n`),
      },
    },
    config: {
      allow_accept: true, // 승인 허용
      allow_edit: true, // 수정 허용
      allow_respond: true, // 응답 허용
      allow_ignore: true, // 무시 허용
    },
    description: `A new plan has been generated for your request. Please review it and either approve it, edit it, respond to it, or ignore it. Responses will be passed to an LLM where it will rewrite then plan.
    If editing the plan, ensure each step in the plan is separated by "${PLAN_INTERRUPT_DELIMITER}".`,
  });

  // 배열이면 첫 번째 응답 사용
  const humanResponse: HumanResponse = Array.isArray(interruptResponse)
    ? interruptResponse[0]
    : interruptResponse;

  // === 6단계: 사용자 응답에 따라 분기 ===

  // 6-1. 응답 (response): 컨텍스트 수집으로 돌아가기
  if (humanResponse.type === "response") {
    return new Command({
      goto: "determine-needs-context",
    });
  }

  // 6-2. 무시 (ignore): 종료
  if (humanResponse.type === "ignore") {
    return new Command({
      goto: END,
    });
  }

  // 6-3. 승인 (accept): Programmer 시작
  if (humanResponse.type === "accept") {
    planItems = proposedPlan.map((p, index) => ({
      index,
      plan: p,
      completed: false,
    }));

    runInput.taskPlan = createNewTask(
      userTaskRequest,
      state.proposedPlanTitle,
      planItems,
      { existingTaskPlan: state.taskPlan },
    );

    // GitHub 이슈에 승인 댓글 게시 (로컬 모드 아닐 때)
    if (!isLocalMode(config) && state.githubIssueId) {
      await postGitHubIssueComment({
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
        commentBody: `### ✅ Plan Accepted ✅\n\nThe proposed plan was accepted.\n\n**Plan: ${state.proposedPlanTitle}**\n\n${planItems.map((step, index) => `- Task ${index + 1}:\n${cleanTaskItems(step.plan)}`).join("\n")}\n\nProceeding to implementation...`,
        config,
      });
    }
  }
  // 6-4. 수정 (edit): 수정된 계획으로 Programmer 시작
  else if (humanResponse.type === "edit") {
    const editedPlan = (humanResponse.args as ActionRequest).args.plan
      .split(PLAN_INTERRUPT_DELIMITER)
      .map((step: string) => step.trim());

    planItems = editedPlan.map((p: string, index: number) => ({
      index,
      plan: p,
      completed: false,
    }));

    runInput.taskPlan = createNewTask(
      userTaskRequest,
      state.proposedPlanTitle,
      planItems,
      { existingTaskPlan: state.taskPlan },
    );

    // GitHub 이슈에 수정 댓글 게시 (로컬 모드 아닐 때)
    if (!isLocalMode(config) && state.githubIssueId) {
      await postGitHubIssueComment({
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
        commentBody: `### ✅ Plan Edited & Submitted ✅\n\nThe proposed plan was edited and submitted.\n\n**Plan: ${state.proposedPlanTitle}**\n\n${planItems.map((step, index) => `- Task ${index + 1}:\n${cleanTaskItems(step.plan)}`).join("\n")}\n\nProceeding to implementation...`,
        config,
      });
    }
  } else {
    throw new Error("Unknown interrupt type." + humanResponse.type);
  }

  // === 7단계: Programmer 시작 ===
  return await startProgrammerRun({
    runInput: runInput as Exclude<GraphUpdate, "taskPlan"> & {
      taskPlan: TaskPlan;
    },
    state,
    config,
    newMessages: [
      createAcceptedPlanMessage({
        planTitle: state.proposedPlanTitle,
        planItems,
        interruptType: humanResponse.type,
        runId: config.configurable?.run_id ?? "",
      }),
    ],
  });
}
