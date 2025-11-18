/**
 * @file 메시지 분류 및 라우팅 노드
 * @description
 * Manager 그래프의 핵심 결정 노드로, LLM을 사용하여 사용자 메시지를 분류하고
 * 적절한 다음 단계(Planner 시작, 세션 생성, 종료 등)로 라우팅합니다.
 *
 * 주요 기능:
 * 1. 현재 실행 중인 Planner/Programmer 스레드 상태 확인
 * 2. LLM을 통한 메시지 의도 분석 및 분류
 * 3. GitHub 이슈 생성 및 댓글 추가
 * 4. 분류 결과에 따른 워크플로우 라우팅
 *
 * 라우팅 경로:
 * - no_op: 단순 응답 후 종료
 * - create_new_issue: 새 세션 생성 노드로 이동
 * - start_planner: 새 Planner 시작
 * - start_planner_for_followup: 후속 작업으로 Planner 시작
 * - update_programmer/update_planner: 실행 중인 에이전트 업데이트 (종료)
 */

// 그래프 설정 타입 (런타임 환경 및 인증 정보)
import { GraphConfig } from "@openswe/shared/open-swe/types";

// Manager 그래프의 상태 및 업데이트 타입
import {
  ManagerGraphState,      // 현재 상태 (읽기 전용)
  ManagerGraphUpdate,     // 상태 업데이트 반환 타입
} from "@openswe/shared/open-swe/manager/types";

// LangGraph SDK 클라이언트 생성 함수 (스레드 상태 조회용)
import { createLangGraphClient } from "../../../../utils/langgraph-client.js";

// LangChain 메시지 타입 및 유틸리티
import {
  BaseMessage,       // 모든 메시지의 기본 타입
  HumanMessage,      // 사용자 메시지 타입
  isHumanMessage,    // HumanMessage 타입 가드 함수
  RemoveMessage,     // 메시지 삭제 명령 (ID 업데이트용)
} from "@langchain/core/messages";

// Zod 스키마 검증 라이브러리 (LLM 응답 파싱용)
import { z } from "zod";

// LLM 모델 로딩 및 기능 감지 유틸리티
import {
  loadModel,                      // 설정에 맞는 LLM 모델 로드
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부 확인
} from "../../../../utils/llms/index.js";

// LLM 작업 유형 (모델 선택 기준)
import { LLMTask } from "@openswe/shared/open-swe/llm-task";

// LangGraph 명령 및 상수
import { Command, END } from "@langchain/langgraph";

// 메시지 콘텐츠 문자열 추출 함수
import { getMessageContentString } from "@openswe/shared/messages";

// GitHub API 호출 함수 (이슈 및 댓글 생성)
import {
  createIssue,        // 새 GitHub 이슈 생성
  createIssueComment, // 기존 이슈에 댓글 추가
} from "../../../../utils/github/api.js";

// GitHub 토큰 추출 유틸리티
import { getGitHubTokensFromConfig } from "../../../../utils/github-tokens.js";

// 메시지에서 GitHub 이슈 필드 생성 함수
import { createIssueFieldsFromMessages } from "../../utils/generate-issue-fields.js";

// 이슈 본문 처리 유틸리티
import {
  extractContentWithoutDetailsFromIssueBody,  // 세부 정보 제거
  extractIssueTitleAndContentFromMessage,      // 제목과 내용 추출
  formatContentForIssueBody,                   // 이슈 본문 포맷팅
} from "../../../../utils/github/issue-messages.js";

// HTTP 헤더 생성 함수 (LangGraph SDK 호출용)
import { getDefaultHeaders } from "../../../../utils/default-headers.js";

// 메시지 분류 스키마 (LLM 응답 구조)
import { BASE_CLASSIFICATION_SCHEMA } from "./schemas.js";

// 이슈에서 작업 계획 추출 함수
import { getPlansFromIssue } from "../../../../utils/github/issue-task.js";

// Human-in-the-loop 응답 타입
import { HumanResponse } from "@langchain/langgraph/prebuilt";

// 시스템 상수 (스트림 모드, 그래프 ID 등)
import {
  OPEN_SWE_STREAM_MODE,  // 기본 스트림 모드 설정
  PLANNER_GRAPH_ID,      // Planner 그래프 식별자
} from "@openswe/shared/constants";

// 로거 생성 함수 및 로그 레벨
import { createLogger, LogLevel } from "../../../../utils/logger.js";

// 분류 프롬프트 및 도구 스키마 생성 함수
import { createClassificationPromptAndToolSchema } from "./utils.js";

// 요청 소스 타입 (웹훅, CLI 등)
import { RequestSource } from "../../../../constants.js";

// LangGraph SDK 타입 (스트림 모드, 스레드)
import { StreamMode, Thread } from "@langchain/langgraph-sdk";

// 로컬 모드 감지 함수
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

// Planner 그래프 상태 타입
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types";

// 공통 그래프 상태 타입
import { GraphState } from "@openswe/shared/open-swe/types";

// LangGraph SDK 클라이언트 타입
import { Client } from "@langchain/langgraph-sdk";

// GitHub 이슈 생성 여부 결정 함수
import { shouldCreateIssue } from "../../../../utils/should-create-issue.js";

// 로거 인스턴스 생성 (INFO 레벨, ClassifyMessage 컨텍스트)
const logger = createLogger(LogLevel.INFO, "ClassifyMessage");

/**
 * 최신 사용자 메시지를 분류하고 적절한 워크플로우로 라우팅하는 핵심 노드 함수
 *
 * @description
 * LLM을 사용하여 사용자의 최신 메시지를 분석하고, 현재 시스템 상태(실행 중인 에이전트 등)를
 * 고려하여 다음 단계를 결정합니다. 이 함수는 Manager 그래프의 가장 복잡한 로직을 포함합니다.
 *
 * 처리 흐름:
 * 1. 최신 사용자 메시지 추출
 * 2. 현재 실행 중인 Planner/Programmer 스레드 상태 확인
 * 3. GitHub 이슈에서 최신 작업 계획 로드
 * 4. LLM을 통해 메시지 분류 및 라우팅 결정
 * 5. 필요 시 GitHub 이슈/댓글 생성
 * 6. Command 객체로 다음 노드 지정
 *
 * 가능한 라우팅 결과:
 * - **no_op**: 응답만 하고 종료 (작업 불필요)
 * - **create_new_issue**: 새 세션 생성 노드로 이동
 * - **start_planner**: 새 Planner 에이전트 시작
 * - **start_planner_for_followup**: 후속 작업으로 Planner 시작
 * - **update_programmer**: Programmer가 새 메시지 처리 (종료)
 * - **update_planner**: Planner가 새 메시지 처리 (종료)
 * - **resume_and_update_planner**: 중단된 Planner 재개 및 업데이트
 *
 * @param {ManagerGraphState} state - 현재 Manager 그래프 상태
 *   - messages: 대화 메시지 이력
 *   - plannerSession: 실행 중인 Planner 세션 정보
 *   - githubIssueId: 연결된 GitHub 이슈 ID
 *   - targetRepository: 대상 저장소 정보
 *   - taskPlan: 현재 작업 계획
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 *   - configurable: 환경 변수 및 설정
 *   - 인증 토큰 정보
 *
 * @returns {Promise<Command>} LangGraph Command 객체
 *   - update: 상태 업데이트 내용
 *   - goto: 다음 노드 이름 (또는 END)
 *
 * @throws {Error} 사용자 메시지가 없을 때
 * @throws {Error} LangGraph 클라이언트 초기화 실패 시
 * @throws {Error} GitHub 이슈 생성 실패 시
 * @throws {Error} 잘못된 라우트가 반환되었을 때
 */
export async function classifyMessage(
  state: ManagerGraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: 최신 사용자 메시지 추출 ===
  // findLast를 사용하여 배열의 마지막에서부터 HumanMessage 검색
  // (가장 최근의 사용자 입력이 중요함)
  const userMessage = state.messages.findLast(isHumanMessage);

  // 사용자 메시지가 없으면 분류할 수 없으므로 에러
  if (!userMessage) {
    throw new Error("사용자 메시지를 찾을 수 없습니다.");
  }

  // === 2단계: 현재 실행 중인 에이전트 스레드 상태 확인 ===
  // Planner와 Programmer의 실행 상태를 확인하여 분류 결정에 사용

  // 스레드 정보 저장 변수 초기화
  let plannerThread: Thread<PlannerGraphState> | undefined;
  let programmerThread: Thread<GraphState> | undefined;
  let langGraphClient: Client | undefined;

  // 로컬 모드가 아닐 때만 LangGraph 클라이언트를 통해 스레드 상태 조회
  // (로컬 모드에서는 별도 스레드 없이 직접 실행)
  if (!isLocalMode(config)) {
    // LangGraph SDK 클라이언트 생성
    // 인증 헤더를 포함하여 원격 LangGraph 서버와 통신
    langGraphClient = createLangGraphClient({
      defaultHeaders: getDefaultHeaders(config),
    });

    // Planner 스레드 조회 (있을 경우)
    // state.plannerSession에 threadId가 있으면 해당 스레드 정보 가져오기
    plannerThread = state.plannerSession?.threadId
      ? await langGraphClient.threads.get(state.plannerSession.threadId)
      : undefined;

    // Planner 스레드의 상태 값 추출
    const plannerThreadValues = plannerThread?.values;

    // Programmer 스레드 조회 (있을 경우)
    // Planner의 상태에 programmerSession이 있으면 해당 스레드 정보 가져오기
    // (Programmer는 Planner에 의해 시작되므로 Planner 상태 내에 있음)
    programmerThread = plannerThreadValues?.programmerSession?.threadId
      ? await langGraphClient.threads.get(
          plannerThreadValues.programmerSession.threadId,
        )
      : undefined;
  }

  // 스레드 상태 추출 (기본값: "not_started")
  // 가능한 상태: "idle", "busy", "interrupted", "error", "not_started" 등
  const programmerStatus = programmerThread?.status ?? "not_started";
  const plannerStatus = plannerThread?.status ?? "not_started";

  // === 3단계: 최신 작업 계획 로드 ===
  // GitHub 이슈에서 최신 작업 계획을 가져옴 (사용자가 이슈를 수정했을 수 있음)
  // githubIssueId가 있으면 이슈에서 로드, 없으면 null
  const issuePlans = state.githubIssueId
    ? await getPlansFromIssue(state, config)
    : null;

  // 이슈에서 추출한 작업 계획이 있으면 사용, 없으면 상태의 기존 계획 사용
  const taskPlan = issuePlans?.taskPlan ?? state.taskPlan;

  // === 4단계: LLM 분류 프롬프트 및 스키마 생성 ===
  // 현재 시스템 상태를 기반으로 동적으로 프롬프트와 응답 스키마 생성
  const { prompt, schema } = createClassificationPromptAndToolSchema({
    programmerStatus,  // Programmer 실행 상태 (LLM이 참고)
    plannerStatus,     // Planner 실행 상태 (LLM이 참고)
    messages: state.messages,  // 전체 대화 이력 (컨텍스트)
    taskPlan,          // 현재 작업 계획 (LLM이 진행 상황 파악용)
    proposedPlan: issuePlans?.proposedPlan ?? undefined,  // 제안된 계획
    requestSource: userMessage.additional_kwargs?.requestSource as
      | RequestSource
      | undefined,  // 요청 출처 (웹훅, CLI 등)
  });

  // LLM이 호출할 도구 정의
  // 이 도구는 메시지 분류 결과를 구조화된 형태로 반환받기 위함
  const respondAndRouteTool = {
    name: "respond_and_route",  // 도구 이름
    description: "사용자 메시지에 응답하고 라우팅 방법을 결정합니다.",  // 도구 설명
    schema,  // Zod 스키마 (응답 구조 정의)
  };

  // === 5단계: LLM 모델 로드 및 설정 ===
  // ROUTER 작업에 맞는 LLM 모델 로드 (일반적으로 빠르고 저렴한 모델 사용)
  const model = await loadModel(config, LLMTask.ROUTER);

  // 모델이 parallel_tool_calls 파라미터를 지원하는지 확인
  // (일부 모델은 이 옵션을 지원하지 않음)
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.ROUTER,
  );

  // 모델에 도구 바인딩
  // tool_choice로 특정 도구를 강제 호출하도록 설정
  const modelWithTools = model.bindTools([respondAndRouteTool], {
    tool_choice: respondAndRouteTool.name,  // respond_and_route 도구 강제 호출
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false,  // 병렬 도구 호출 비활성화 (하나만 호출)
        }
      : {}),
  });

  // === 6단계: LLM 호출 및 분류 결과 받기 ===
  // 시스템 프롬프트와 사용자 메시지를 전달하여 LLM 호출
  const response = await modelWithTools.invoke([
    {
      role: "system",  // 시스템 메시지 (분류 지침 및 현재 상태 정보)
      content: prompt,
    },
    {
      role: "user",  // 사용자 메시지 (분류 대상)
      // 이슈 본문에서 <details> 태그 등 불필요한 세부 정보 제거
      content: extractContentWithoutDetailsFromIssueBody(
        getMessageContentString(userMessage.content),
      ),
    },
  ]);

  // === 7단계: LLM 응답에서 도구 호출 결과 추출 ===
  // LLM은 respond_and_route 도구를 호출하여 분류 결과를 반환함
  const toolCall = response.tool_calls?.[0];

  // 도구 호출이 없으면 에러 (LLM이 예상대로 응답하지 않음)
  if (!toolCall) {
    throw new Error("도구 호출을 찾을 수 없습니다.");
  }

  // 도구 호출 인자를 타입 체크하여 추출
  // BASE_CLASSIFICATION_SCHEMA에 정의된 구조로 파싱
  const toolCallArgs = toolCall.args as z.infer<
    typeof BASE_CLASSIFICATION_SCHEMA
  >;

  // === 8단계: 라우팅 결과에 따른 처리 ===
  // LLM이 반환한 route 값에 따라 적절한 다음 노드로 라우팅

  // --- 라우트 1: no_op (응답만 하고 종료) ---
  if (toolCallArgs.route === "no_op") {
    // 사용자 메시지가 작업 요청이 아니거나, 단순 질문인 경우
    // LLM의 응답 메시지만 상태에 추가하고 워크플로우 종료
    const commandUpdate: ManagerGraphUpdate = {
      messages: [response],  // LLM 응답 메시지 추가
    };

    return new Command({
      update: commandUpdate,
      goto: END,  // 워크플로우 종료
    });
  }

  // --- 라우트 2: create_new_issue (새 세션 생성) ---
  if ((toolCallArgs.route as string) === "create_new_issue") {
    // 기존 작업과 별도로 새로운 세션을 시작해야 하는 경우
    // (예: 진행 중인 작업이 있지만 완전히 다른 작업 요청)
    const commandUpdate: ManagerGraphUpdate = {
      messages: [response],  // LLM 응답 추가
    };

    return new Command({
      update: commandUpdate,
      goto: "create-new-session",  // 새 세션 생성 노드로 이동
    });
  }

  // --- 로컬 모드 처리 ---
  // CLI에서 실행 중인 경우 GitHub 이슈 없이 직접 Planner로 라우팅
  if (isLocalMode(config)) {
    // LLM 응답 메시지를 배열에 저장
    const newMessages: BaseMessage[] = [response];

    const commandUpdate: ManagerGraphUpdate = {
      messages: newMessages,
    };

    // start_planner 또는 start_planner_for_followup인 경우 Planner 시작
    if (
      toolCallArgs.route === "start_planner" ||
      toolCallArgs.route === "start_planner_for_followup"
    ) {
      return new Command({
        update: commandUpdate,
        goto: "start-planner",  // Planner 시작 노드로 이동
      });
    }

    // 로컬 모드에서 지원하지 않는 라우트인 경우 에러
    // (로컬 모드는 제한된 기능만 지원)
    throw new Error(
      `로컬 모드에서 지원되지 않는 라우트 수신: ${toolCallArgs.route}`,
    );
  }

  // --- GitHub 이슈 생성 비활성화 모드 처리 ---
  // 설정에서 GitHub 이슈 자동 생성을 비활성화한 경우
  if (!shouldCreateIssue(config)) {
    const commandUpdate: ManagerGraphUpdate = {
      messages: [response],
    };

    // Planner 시작 라우트인 경우
    if (
      toolCallArgs.route === "start_planner" ||
      toolCallArgs.route === "start_planner_for_followup"
    ) {
      return new Command({
        update: commandUpdate,
        goto: "start-planner",
      });
    }

    // 새 이슈 생성 라우트인 경우
    if (toolCallArgs.route === "create_new_issue") {
      return new Command({
        update: commandUpdate,
        goto: "create-new-session",
      });
    }

    // no_op 라우트인 경우
    if (toolCallArgs.route === "no_op") {
      return new Command({
        update: commandUpdate,
        goto: END,
      });
    }

    // 지원되지 않는 라우트인 경우 에러
    // (이슈 생성 없이는 일부 라우트를 처리할 수 없음)
    throw new Error(
      `지원되지 않는 라우트 수신: ${toolCallArgs.route}\n요청에 대한 GitHub 이슈를 생성하지 않을 때 메시지를 라우팅할 수 없습니다.`,
    );
  }

  // === 9단계: GitHub 이슈 생성 또는 업데이트 ===

  // GitHub 액세스 토큰 추출 (이슈/댓글 생성에 필요)
  const { githubAccessToken } = getGitHubTokensFromConfig(config);

  // 현재 GitHub 이슈 ID (없으면 undefined)
  let githubIssueId = state.githubIssueId;

  // 새로 추가할 메시지 배열 (LLM 응답 포함)
  const newMessages: BaseMessage[] = [response];

  // --- 시나리오 1: GitHub 이슈가 아직 없는 경우 (최초 작업 요청) ---
  if (!githubIssueId) {
    // 메시지 이력에서 이슈 제목 생성
    // (LLM이 대화 내용을 요약하여 적절한 제목 생성)
    const { title } = await createIssueFieldsFromMessages(
      state.messages,
      config.configurable,
    );

    // 사용자 메시지에서 이슈 본문 추출
    const { content: body } = extractIssueTitleAndContentFromMessage(
      getMessageContentString(userMessage.content),
    );

    // GitHub API를 통해 새 이슈 생성
    const newIssue = await createIssue({
      owner: state.targetRepository.owner,      // 저장소 소유자
      repo: state.targetRepository.repo,        // 저장소 이름
      title,                                     // 생성된 제목
      body: formatContentForIssueBody(body),    // 포맷팅된 본문
      githubAccessToken,                         // 인증 토큰
    });

    // 이슈 생성 실패 시 에러
    if (!newIssue) {
      throw new Error("이슈 생성에 실패했습니다.");
    }

    // 생성된 이슈 번호 저장
    githubIssueId = newIssue.number;

    // 기존 사용자 메시지를 제거하고 이슈 ID가 포함된 새 메시지로 교체
    // (메시지 ID는 불변이므로 RemoveMessage + 새 HumanMessage 패턴 사용)
    newMessages.push(
      ...[
        new RemoveMessage({
          id: userMessage.id ?? "",  // 기존 메시지 ID
        }),
        new HumanMessage({
          ...userMessage,  // 기존 메시지 내용 복사
          additional_kwargs: {
            githubIssueId: githubIssueId,  // 생성된 이슈 ID 추가
            isOriginalIssue: true,          // 최초 이슈임을 표시
          },
        }),
      ],
    );
  }
  // --- 시나리오 2: GitHub 이슈가 있고 추가 메시지가 있는 경우 ---
  else if (
    githubIssueId &&
    state.messages.filter(isHumanMessage).length > 1
  ) {
    // 기존 GitHub 이슈가 있고, 여러 개의 사용자 메시지가 있는 경우
    // 아직 GitHub에 추가되지 않은 메시지를 이슈 댓글로 추가

    // 이슈에 아직 추가되지 않은 메시지 필터링
    const messagesNotInIssue = state.messages
      .filter(isHumanMessage)  // HumanMessage만 선택
      .filter((message) => {
        // additional_kwargs에 githubIssueId가 없으면 아직 이슈에 추가되지 않은 것
        return !message.additional_kwargs?.githubIssueId;
      });

    // 각 메시지를 GitHub 이슈 댓글로 추가하는 Promise 배열 생성
    const createCommentsPromise = messagesNotInIssue.map(async (message) => {
      // GitHub API를 통해 이슈 댓글 생성
      const createdIssue = await createIssueComment({
        owner: state.targetRepository.owner,        // 저장소 소유자
        repo: state.targetRepository.repo,          // 저장소 이름
        issueNumber: githubIssueId,                 // 이슈 번호
        body: getMessageContentString(message.content),  // 댓글 내용
        githubToken: githubAccessToken,             // 인증 토큰
      });

      // 댓글 생성 실패 시 에러
      if (!createdIssue?.id) {
        throw new Error("이슈 댓글 생성에 실패했습니다.");
      }

      // 기존 메시지를 제거하고 댓글 ID가 포함된 새 메시지로 교체
      newMessages.push(
        ...[
          new RemoveMessage({
            id: message.id ?? "",  // 기존 메시지 ID
          }),
          new HumanMessage({
            ...message,  // 기존 메시지 내용 복사
            additional_kwargs: {
              githubIssueId,                      // 이슈 ID 추가
              githubIssueCommentId: createdIssue.id,  // 댓글 ID 추가
              // 후속 작업인 경우 isFollowup 플래그 추가
              ...((toolCallArgs.route as string) ===
              "start_planner_for_followup"
                ? {
                    isFollowup: true,
                  }
                : {}),
            },
          }),
        ],
      );
    });

    // 모든 댓글 생성 Promise를 병렬로 실행하고 완료 대기
    await Promise.all(createCommentsPromise);

    // === 10단계: Planner 재개 처리 (필요 시) ===

    // 새 Planner 실행 ID (재개 시 생성됨)
    let newPlannerId: string | undefined;

    // 다음 노드 (기본값: 종료)
    let goto = END;

    // Planner가 중단(interrupted) 상태인 경우 재개 시도
    if (plannerStatus === "interrupted") {
      // Planner 세션 스레드 ID 확인
      if (!state.plannerSession?.threadId) {
        throw new Error("플래너 세션을 찾을 수 없습니다. 플래너를 재개할 수 없습니다.");
      }

      // Human-in-the-loop 응답으로 Planner 재개
      // (Planner가 사용자 입력을 기다리고 있었음)
      const plannerResume: HumanResponse = {
        type: "response",          // 응답 타입
        args: "resume planner",    // 재개 명령
      };

      logger.info("플래너 세션 재개 중");

      // LangGraph 클라이언트 확인
      if (!langGraphClient) {
        throw new Error("LangGraph 클라이언트가 초기화되지 않았습니다.");
      }

      // Planner 그래프에 새 실행 생성 (재개 명령 포함)
      const newPlannerRun = await langGraphClient.runs.create(
        state.plannerSession?.threadId,  // 기존 스레드 ID
        PLANNER_GRAPH_ID,                 // Planner 그래프 ID
        {
          command: {
            resume: plannerResume,  // 재개 명령
          },
          streamMode: OPEN_SWE_STREAM_MODE as StreamMode[],  // 스트림 모드
        },
      );

      // 새 실행 ID 저장
      newPlannerId = newPlannerRun.run_id;

      logger.info("플래너 세션이 재개되었습니다.", {
        runId: newPlannerRun.run_id,
        threadId: state.plannerSession.threadId,
      });
    }

    // 후속 작업으로 Planner를 시작해야 하는 경우
    if (toolCallArgs.route === "start_planner_for_followup") {
      goto = "start-planner";
    }

    // === 11단계: 상태 업데이트 및 반환 ===
    // 새 댓글을 추가한 후 메시지를 상태에 추가하고 적절한 노드로 이동
    const commandUpdate: ManagerGraphUpdate = {
      messages: newMessages,  // 업데이트된 메시지 목록
      // Planner가 재개되었으면 새 세션 정보 추가
      ...(newPlannerId && state.plannerSession?.threadId
        ? {
            plannerSession: {
              threadId: state.plannerSession.threadId,  // 기존 스레드 ID 유지
              runId: newPlannerId,                       // 새 실행 ID
            },
          }
        : {}),
    };

    return new Command({
      update: commandUpdate,
      goto,  // 다음 노드 (start-planner 또는 END)
    });
  }

  // === 12단계: 최종 라우팅 결정 ===
  // 이슈가 생성되었고 필요한 메시지가 모두 추가되었음
  // 이제 LLM이 결정한 라우트에 따라 최종 노드로 이동

  const commandUpdate: ManagerGraphUpdate = {
    messages: newMessages,  // 업데이트된 메시지 목록
    ...(githubIssueId ? { githubIssueId } : {}),  // 이슈 ID가 있으면 추가
  };

  // --- 라우트: update_programmer, update_planner, resume_and_update_planner ---
  // 실행 중인 에이전트가 이미 있고, 새 메시지만 GitHub에 추가하면 되는 경우
  if (
    (toolCallArgs.route as any) === "update_programmer" ||
    (toolCallArgs.route as any) === "update_planner" ||
    (toolCallArgs.route as any) === "resume_and_update_planner"
  ) {
    // 이슈에 새 메시지가 댓글로 추가되었으므로,
    // 실행 중인 Planner/Programmer가 GitHub API를 통해 이를 가져올 것임
    // Manager는 아무것도 할 필요 없이 종료
    //
    // 참고: 이 코드 블록은 실제로는 도달할 수 없을 수 있음
    // (위에서 댓글 추가 후 조기 반환했을 수 있음)
    // 하지만 안전을 위해 포함
    return new Command({
      update: commandUpdate,
      goto: END,  // 워크플로우 종료
    });
  }

  // --- 라우트: start_planner, start_planner_for_followup ---
  // 새 Planner를 시작해야 하는 경우
  if (
    toolCallArgs.route === "start_planner" ||
    toolCallArgs.route === "start_planner_for_followup"
  ) {
    // start-planner 노드로 이동하여 새 Planner 그래프 실행 시작
    // 이렇게 하면 Planner 그래프에 새 실행이 대기열에 추가됨
    return new Command({
      update: commandUpdate,
      goto: "start-planner",  // Planner 시작 노드로 이동
    });
  }

  // 위의 모든 라우트 처리 조건에 해당하지 않는 경우 에러
  // (예상치 못한 라우트 값이 반환됨)
  throw new Error(`잘못된 라우트: ${toolCallArgs.route}`);
}
