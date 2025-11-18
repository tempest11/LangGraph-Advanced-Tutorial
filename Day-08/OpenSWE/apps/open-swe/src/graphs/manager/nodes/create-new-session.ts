/**
 * @file 새 세션 생성 노드
 * @description
 * 기존 작업과 독립적인 새로운 Manager 세션을 생성하는 노드입니다.
 *
 * 주요 기능:
 * 1. 대화 내역에서 이슈 제목 및 본문 추출
 * 2. 새 GitHub 이슈 생성
 * 3. 새 Manager 스레드 생성
 * 4. 새 Manager를 start-planner 노드에서 시작
 * 5. 원래 Manager에 새 세션 생성 알림 메시지 반환
 *
 * 사용 시나리오:
 * - 사용자가 진행 중인 작업과 별개로 새로운 작업 요청
 * - 병렬로 여러 작업을 동시에 진행하고 싶을 때
 */

// UUID v4 생성 함수 - 새 스레드 및 메시지 ID 생성용
import { v4 as uuidv4 } from "uuid";

// 그래프 설정 타입
import { GraphConfig } from "@openswe/shared/open-swe/types";

// Manager 그래프 상태 및 업데이트 타입
import {
  ManagerGraphState,      // 현재 상태
  ManagerGraphUpdate,     // 반환할 업데이트
} from "@openswe/shared/open-swe/manager/types";

// 메시지에서 이슈 필드 생성 함수 (LLM 사용)
import { createIssueFieldsFromMessages } from "../utils/generate-issue-fields.js";

// 시스템 상수
import {
  GITHUB_INSTALLATION_ID,             // GitHub 설치 ID 헤더 키
  GITHUB_INSTALLATION_TOKEN_COOKIE,   // GitHub 설치 토큰 쿠키 키
  GITHUB_PAT,                         // GitHub 개인 액세스 토큰 헤더 키
  LOCAL_MODE_HEADER,                  // 로컬 모드 헤더 키
  MANAGER_GRAPH_ID,                   // Manager 그래프 식별자
  OPEN_SWE_STREAM_MODE,               // 스트림 모드 설정
} from "@openswe/shared/constants";

// LangGraph SDK 클라이언트 생성 함수
import { createLangGraphClient } from "../../../utils/langgraph-client.js";

// GitHub 이슈 생성 API 함수
import { createIssue } from "../../../utils/github/api.js";

// GitHub 토큰 추출 함수
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js";

// LangChain 메시지 타입
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";

// 이슈 본문 포맷팅 관련 상수 및 함수
import {
  ISSUE_TITLE_CLOSE_TAG,      // 이슈 제목 종료 태그
  ISSUE_TITLE_OPEN_TAG,        // 이슈 제목 시작 태그
  ISSUE_CONTENT_CLOSE_TAG,     // 이슈 내용 종료 태그
  ISSUE_CONTENT_OPEN_TAG,      // 이슈 내용 시작 태그
  formatContentForIssueBody,   // 이슈 본문 포맷팅 함수
} from "../../../utils/github/issue-messages.js";

// Git 브랜치 이름 생성 함수
import { getBranchName } from "../../../utils/github/git.js";

// HTTP 헤더 생성 함수
import { getDefaultHeaders } from "../../../utils/default-headers.js";

// 설정 가능한 필드 추출 함수
import { getCustomConfigurableFields } from "@openswe/shared/open-swe/utils/config";

// LangGraph SDK 스트림 모드 타입
import { StreamMode } from "@langchain/langgraph-sdk";

// 로컬 모드 감지 함수
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

// GitHub 설치 토큰 재생성 함수
import { regenerateInstallationToken } from "../../../utils/github/regenerate-token.js";

// 로거 생성 함수
import { createLogger, LogLevel } from "../../../utils/logger.js";

// GitHub 이슈 생성 여부 결정 함수
import { shouldCreateIssue } from "../../../utils/should-create-issue.js";

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "CreateNewSession");

/**
 * 독립적인 새 Manager 세션을 생성하는 노드 함수
 *
 * @description
 * 기존 작업과 병렬로 새로운 작업을 시작하기 위해 완전히 독립적인
 * Manager 세션을 생성합니다. 새 GitHub 이슈를 만들고, 새 Manager 스레드를
 * 시작한 후, 원래 Manager에 알림 메시지를 반환합니다.
 *
 * 주요 처리 흐름:
 * 1. 대화 내역에서 이슈 제목/본문 추출 (LLM 사용)
 * 2. 새 GitHub 이슈 생성
 * 3. 새 Manager용 초기 메시지 구성
 * 4. GitHub 설치 토큰 재생성
 * 5. 새 Manager 스레드 생성 및 start-planner로 라우팅
 * 6. 원래 Manager에 성공 알림 반환
 *
 * @param {ManagerGraphState} state - 현재 Manager 그래프 상태
 *   - messages: 대화 이력 (이슈 제목/본문 추출용)
 *   - targetRepository: 대상 저장소 (새 이슈 생성용)
 *   - branchName: Git 브랜치 이름
 *
 * @param {GraphConfig} config - 그래프 실행 설정
 *
 * @returns {Promise<ManagerGraphUpdate>} 원래 Manager에 추가할 알림 메시지
 *   - messages: 새 세션 생성 성공 메시지 및 링크
 *
 * @throws {Error} GitHub 이슈 생성 실패 시
 */
export async function createNewSession(
  state: ManagerGraphState,
  config: GraphConfig,
): Promise<ManagerGraphUpdate> {
  // === 1단계: 대화 내역에서 이슈 제목 및 본문 추출 ===
  // LLM을 사용하여 대화 메시지들을 분석하고 적절한 이슈 제목과 본문 생성
  const titleAndContent = await createIssueFieldsFromMessages(
    state.messages,         // 대화 이력
    config.configurable,    // LLM 설정 (모델 선택 등)
  );

  // === 2단계: 새 GitHub 이슈 생성 (선택적) ===
  // 설정에 따라 이슈 생성 여부 결정
  let newIssueNumber: number | undefined;

  if (shouldCreateIssue(config)) {
    // GitHub 액세스 토큰 추출
    const { githubAccessToken } = getGitHubTokensFromConfig(config);

    // GitHub API를 통해 새 이슈 생성
    const newIssue = await createIssue({
      owner: state.targetRepository.owner,            // 저장소 소유자
      repo: state.targetRepository.repo,              // 저장소 이름
      title: titleAndContent.title,                   // LLM이 생성한 제목
      body: formatContentForIssueBody(titleAndContent.body),  // 포맷팅된 본문
      githubAccessToken,                              // 인증 토큰
    });

    // 이슈 생성 실패 시 에러
    if (!newIssue) {
      throw new Error("새로운 이슈 생성에 실패했습니다.");
    }

    // 생성된 이슈 번호 저장
    newIssueNumber = newIssue.number;
  }

  // === 3단계: 새 Manager용 초기 메시지 구성 ===
  // 새 Manager 세션이 시작될 때 받을 초기 메시지 배열
  const inputMessages: BaseMessage[] = [
    // 사용자 요청을 나타내는 HumanMessage
    new HumanMessage({
      id: uuidv4(),  // 고유 메시지 ID
      // 이슈 제목과 내용을 특수 태그로 감싸서 포맷팅
      // 이 포맷은 initialize-github-issue 노드가 파싱할 수 있는 형식
      content: `${ISSUE_TITLE_OPEN_TAG}
  ${titleAndContent.title}
${ISSUE_TITLE_CLOSE_TAG}

${ISSUE_CONTENT_OPEN_TAG}
  ${titleAndContent.body}
${ISSUE_CONTENT_CLOSE_TAG}`,
      // 메타데이터 추가
      additional_kwargs: {
        githubIssueId: newIssueNumber,  // 생성된 이슈 ID
        isOriginalIssue: true,          // 최초 이슈임을 표시
      },
    }),
    // 시스템 응답 메시지 (사용자에게 세션 생성 확인)
    new AIMessage({
      id: uuidv4(),
      content:
        "요청에 대한 새로운 GitHub 이슈를 성공적으로 생성하고 계획 세션을 시작했습니다!",
    }),
  ];

  // === 4단계: HTTP 헤더 설정 및 토큰 재생성 ===
  const isLocal = isLocalMode(config);

  // 로컬 모드 여부에 따라 헤더 구성
  const defaultHeaders = isLocal
    ? { [LOCAL_MODE_HEADER]: "true" }  // 로컬 모드 플래그만
    : getDefaultHeaders(config);        // GitHub 인증 정보 포함

  // GitHub 설치 토큰 재생성 (필요 시)
  // PAT를 사용하지 않는 경우에만 설치 토큰 갱신
  if (!isLocal && !(GITHUB_PAT in defaultHeaders)) {
    logger.info("새 세션을 시작하기 전에 설치 토큰을 재생성합니다.");

    // 새 설치 토큰 발급 및 헤더에 추가
    defaultHeaders[GITHUB_INSTALLATION_TOKEN_COOKIE] =
      await regenerateInstallationToken(defaultHeaders[GITHUB_INSTALLATION_ID]);

    logger.info("새 세션을 시작하기 전에 설치 토큰을 재생성했습니다.");
  }

  // === 5단계: 새 Manager 스레드 생성 및 실행 ===
  // LangGraph SDK 클라이언트 생성
  const langGraphClient = createLangGraphClient({
    defaultHeaders,
  });

  // 새 Manager 스레드 ID 생성
  const newManagerThreadId = uuidv4();

  // 새 Manager의 초기 상태 구성
  const commandUpdate: ManagerGraphUpdate = {
    githubIssueId: newIssueNumber,          // 새 이슈 ID
    targetRepository: state.targetRepository,  // 대상 저장소 (기존과 동일)
    messages: inputMessages,                 // 초기 메시지
    branchName: state.branchName ?? getBranchName(config),  // 브랜치 이름
  };

  // 새 Manager 그래프 실행 생성
  // command.goto를 사용하여 initialize-github-issue를 건너뛰고
  // 바로 start-planner 노드로 이동 (이미 이슈와 메시지가 준비됨)
  await langGraphClient.runs.create(newManagerThreadId, MANAGER_GRAPH_ID, {
    input: {},  // 초기 입력은 비어있음 (command.update로 상태 설정)

    // Command 객체로 초기 상태 설정 및 시작 노드 지정
    command: {
      update: commandUpdate,    // 초기 상태 업데이트
      goto: "start-planner",    // start-planner 노드에서 시작
    },

    // 그래프 실행 설정
    config: {
      recursion_limit: 400,  // 재귀 제한
      configurable: getCustomConfigurableFields(config),  // 커스텀 설정
    },

    // 스레드가 없으면 자동 생성
    ifNotExists: "create",

    // 스트림 재개 가능
    streamResumable: true,

    // 스트림 모드 설정
    streamMode: OPEN_SWE_STREAM_MODE as StreamMode[],
  });

  // === 6단계: 원래 Manager에 성공 알림 반환 ===
  // 새 세션이 시작되었음을 알리는 메시지를 원래 Manager 상태에 추가
  return {
    messages: [
      new AIMessage({
        id: uuidv4(),
        // 새 스레드 ID와 링크를 포함한 성공 메시지
        content: `성공! 요청에 대한 새 세션을 만들었습니다. 스레드 ID: \`${newManagerThreadId}\`

스레드를 보려면 [여기](/chat/${newManagerThreadId})를 클릭하세요.`,
      }),
    ],
  };
}
