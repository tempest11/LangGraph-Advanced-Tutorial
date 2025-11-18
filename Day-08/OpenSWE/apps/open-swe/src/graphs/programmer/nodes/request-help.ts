/**
 * @file Programmer의 사람 도움 요청 노드
 * @description
 * LLM이 작업을 계속하기 어려운 상황에서 사람의 도움을 요청하는 노드입니다.
 * HumanInterrupt를 사용하여 사용자 응답을 기다리고, GitHub 이슈에 댓글을 달아 알림을 보냅니다.
 *
 * 주요 기능:
 * - request_help 도구 호출 감지
 * - 샌드박스 중지 (응답 대기 중 비용 절감)
 * - GitHub 이슈에 도움 요청 댓글 작성 (클라우드 모드)
 * - HumanInterrupt로 사용자 응답 대기
 * - 응답 처리 후 샌드박스 재시작
 *
 * 사용자 옵션:
 * - response: 도움말 제공 (계속 진행)
 * - ignore: 작업 중단 (END로 라우팅)
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid"; // UUID 생성

// LangChain 메시지 타입
import { AIMessage, isAIMessage, ToolMessage } from "@langchain/core/messages"; // AI 메시지, 타입 가드, 도구 메시지

// Open SWE 공유 타입
import {
  GraphConfig, // LangGraph 설정 타입
  GraphState, // 그래프 전역 상태 타입
  GraphUpdate, // 상태 업데이트 타입
} from "@openswe/shared/open-swe/types";

// LangGraph 인터럽트
import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt"; // 사람 인터랙션 타입
import { END, interrupt, Command } from "@langchain/langgraph"; // 그래프 제어

// 공유 상수
import {
  DO_NOT_RENDER_ID_PREFIX, // 렌더링하지 않을 메시지 ID 접두사
  GITHUB_USER_LOGIN_HEADER, // GitHub 사용자 로그인 헤더
} from "@openswe/shared/constants";

// 유틸리티 함수
import {
  getSandboxWithErrorHandling, // 샌드박스 가져오기 (에러 처리 포함)
  stopSandbox, // 샌드박스 중지
} from "../../../utils/sandbox.js";
import { getOpenSweAppUrl } from "../../../utils/url-helpers.js"; // Open SWE 앱 URL 생성
import {
  CustomNodeEvent, // 커스텀 노드 이벤트 타입
  REQUEST_HELP_NODE_ID, // 도움 요청 노드 ID
} from "@openswe/shared/open-swe/custom-node-events";
import { postGitHubIssueComment } from "../../../utils/github/plan.js"; // GitHub 이슈 댓글 작성
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // GitHub 이슈 생성 여부 판단
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 확인

/**
 * 도움 요청 설명 텍스트를 구성합니다
 *
 * @description
 * 사용자에게 표시할 도움 요청 메시지를 포맷팅합니다.
 *
 * @param {string} helpRequest - LLM이 요청한 도움 내용
 * @returns {string} 포맷팅된 설명 텍스트
 */
const constructDescription = (helpRequest: string): string => {
  return `The agent has requested help. Here is the help request:

\`\`\`
${helpRequest}
\`\`\``;
};

/**
 * 커스텀 이벤트를 포함한 AI 메시지를 생성합니다
 *
 * @description
 * UI에 표시하지 않고 (hidden) 이벤트 데이터만 전달하는 메시지를 만듭니다.
 *
 * @param {CustomNodeEvent[]} events - 커스텀 노드 이벤트 배열
 * @returns {AIMessage} 이벤트를 포함한 숨김 메시지
 */
const createEventsMessage = (events: CustomNodeEvent[]) =>
  new AIMessage({
    id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
    content: "Request help response",
    additional_kwargs: {
      hidden: true, // UI에 표시하지 않음
      customNodeEvents: events,
    },
  });

/**
 * 사람의 도움을 요청하고 응답을 처리하는 노드 함수입니다
 *
 * @description
 * LLM이 "request_help" 도구를 호출하면 실행됩니다.
 * 샌드박스를 중지하고, GitHub에 댓글을 달고, 사용자 응답을 대기합니다.
 *
 * 처리 흐름:
 * 1. request_help 도구 호출 검증
 * 2. 샌드박스 중지 (비용 절감)
 * 3. GitHub 이슈에 도움 요청 댓글 작성 (클라우드 모드)
 * 4. HumanInterrupt로 사용자 응답 대기
 * 5. 응답 처리:
 *    - ignore: 작업 종료 (END)
 *    - response: 샌드박스 재시작 후 계속 진행 (generate-action)
 *
 * @param {GraphState} state - 현재 그래프 상태 (메시지, 샌드박스 ID, GitHub 정보 포함)
 * @param {GraphConfig} config - 그래프 설정 (모드, 사용자 정보 등)
 * @returns {Promise<Command>} 상태 업데이트 및 다음 노드 라우팅 명령
 * @throws {Error} AI 메시지나 thread ID를 찾을 수 없거나 응답 타입이 잘못되었을 때
 *
 * @example
 * // 도움 요청 후 사용자가 응답한 경우
 * const command = await requestHelp(state, config);
 * // => Command { update: {...}, goto: "generate-action" }
 *
 * @example
 * // 도움 요청 후 사용자가 무시한 경우
 * const command = await requestHelp(state, config);
 * // => Command { goto: END }
 */
export async function requestHelp(
  state: GraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: request_help 도구 호출 검증 ===
  const lastMessage = state.internalMessages[state.internalMessages.length - 1];
  if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
    throw new Error("Last message is not an AI message with tool calls.");
  }

  // === 2단계: 샌드박스 중지 (응답 대기 중 비용 절감) ===
  const sandboxSessionId = state.sandboxSessionId;
  if (sandboxSessionId) {
    await stopSandbox(sandboxSessionId);
  }

  const toolCall = lastMessage.tool_calls[0];

  // === 3단계: Thread ID 확인 ===
  const threadId = config.configurable?.thread_id;
  if (!threadId) {
    throw new Error("Thread ID not found in config");
  }

  // === 4단계: GitHub 이슈에 도움 요청 댓글 작성 (클라우드 모드만) ===
  if (!isLocalMode(config) && shouldCreateIssue(config)) {
    const userLogin = config.configurable?.[GITHUB_USER_LOGIN_HEADER];
    const userTag = userLogin ? `@${userLogin} ` : "";
    const runUrl = getOpenSweAppUrl(threadId);

    const commentBody = runUrl
      ? `### 🤖 Open SWE Needs Help

${userTag}I've encountered a situation where I need human assistance to continue.

**Help Request:**
${toolCall.args.help_request}

You can view and respond to this request in the [Open SWE interface](${runUrl}).

Please provide guidance so I can continue working on this issue.`
      : `### 🤖 Open SWE Needs Help

${userTag}I've encountered a situation where I need human assistance to continue.

**Help Request:**
${toolCall.args.help_request}

Please check the Open SWE interface to respond to this request.`;

    await postGitHubIssueComment({
      githubIssueId: state.githubIssueId,
      targetRepository: state.targetRepository,
      commentBody,
      config,
    });
  }

  // === 5단계: HumanInterrupt 설정 및 사용자 응답 대기 ===
  const interruptInput: HumanInterrupt = {
    action_request: {
      action: "Help Requested",
      args: {},
    },
    config: {
      allow_accept: false, // "accept" 옵션 비활성화
      allow_edit: false, // "edit" 옵션 비활성화
      allow_ignore: true, // "ignore" 옵션 활성화 (작업 중단)
      allow_respond: true, // "response" 옵션 활성화 (도움말 제공)
    },
    description: constructDescription(toolCall.args.help_request),
  };

  const interruptRes = interrupt<HumanInterrupt[], HumanResponse[]>([
    interruptInput,
  ])[0];

  // === 6단계: 사용자 응답 처리 ===
  // 6-1. 사용자가 무시한 경우 → 작업 종료
  if (interruptRes.type === "ignore") {
    return new Command({
      goto: END,
    });
  }

  // 6-2. 사용자가 응답한 경우 → 샌드박스 재시작 후 계속 진행
  if (interruptRes.type === "response") {
    if (typeof interruptRes.args !== "string") {
      throw new Error("Interrupt response expected to be a string.");
    }

    // 샌드박스 재시작 및 코드베이스 트리 업데이트
    const { sandbox, codebaseTree, dependenciesInstalled } =
      await getSandboxWithErrorHandling(
        state.sandboxSessionId,
        state.targetRepository,
        state.branchName,
        config,
      );

    // 사용자 응답을 ToolMessage로 변환
    const toolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCall.id ?? "",
      content: `Human response: ${interruptRes.args}`,
      status: "success",
    });

    // 커스텀 이벤트 생성 (UI 업데이트용)
    const customEvent = [
      {
        nodeId: REQUEST_HELP_NODE_ID,
        actionId: uuidv4(),
        action: "Help request response",
        createdAt: new Date().toISOString(),
        data: {
          status: "success" as const,
          response: interruptRes.args,
          runId: config.configurable?.run_id ?? "",
        },
      },
    ];

    try {
      config?.writer?.(customEvent);
    } catch {
      // 이벤트 전송 실패해도 계속 진행
    }

    const humanResponseCustomEventMsg = createEventsMessage(customEvent);

    // 상태 업데이트
    const commandUpdate: GraphUpdate = {
      messages: [toolMessage, humanResponseCustomEventMsg],
      internalMessages: [toolMessage],
      sandboxSessionId: sandbox.id,
      ...(codebaseTree && { codebaseTree }),
      ...(dependenciesInstalled !== null && { dependenciesInstalled }),
    };

    return new Command({
      goto: "generate-action",
      update: commandUpdate,
    });
  }

  // === 7단계: 유효하지 않은 응답 타입 에러 ===
  throw new Error(
    `Invalid interrupt response type. Must be one of 'ignore' or 'response'. Received: ${interruptRes.type}`,
  );
}
