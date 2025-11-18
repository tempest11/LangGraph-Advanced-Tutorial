/**
 * @file Planner 그래프 상태 준비 노드
 * @description
 * Planner 그래프의 첫 번째 노드로, GitHub 이슈와 댓글을 로드하여 메시지 상태를 준비합니다.
 *
 * 주요 기능:
 * 1. GitHub 이슈와 댓글 가져오기
 * 2. 새로운 댓글 추적
 * 3. 이전 요약 메시지 유지 및 불필요한 메시지 제거
 * 4. 로컬 모드 또는 이슈 생성 불필요 시 스킵
 *
 * 처리 흐름:
 * 1. 로컬 모드 또는 이슈 불필요 → 바로 샌드박스 초기화로 이동
 * 2. GitHub 이슈와 댓글 가져오기
 * 3. 메시지가 없으면 → 모든 댓글을 HumanMessage로 변환
 * 4. 메시지가 있으면 → 새 댓글만 추가, 요약 아닌 메시지 제거
 */

// === Planner 타입 ===
import {
  PlannerGraphState, // Planner 그래프 상태 타입
  PlannerGraphUpdate, // Planner 그래프 업데이트 타입
} from "@openswe/shared/open-swe/planner/types";

// === LangGraph ===
import { Command } from "@langchain/langgraph"; // 다음 노드로 이동하는 Command 객체

// === GitHub 인증 ===
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js"; // GraphConfig에서 GitHub 토큰 추출

// === GitHub API ===
import { getIssue, getIssueComments } from "../../../utils/github/api.js"; // 이슈/댓글 조회

// === UUID ===
import { v4 as uuidv4 } from "uuid"; // 고유 메시지 ID 생성

// === LangChain 메시지 ===
import {
  AIMessage, // AI 응답 메시지
  BaseMessage, // 메시지 기본 타입
  HumanMessage, // 사용자 입력 메시지
  isHumanMessage, // HumanMessage 타입 가드
  RemoveMessage, // 메시지 제거 명령
} from "@langchain/core/messages";

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // LangGraph 설정 객체

// === GitHub 이슈 메시지 유틸리티 ===
import {
  getMessageContentFromIssue, // 이슈/댓글을 메시지 컨텐츠로 변환
  getUntrackedComments, // 아직 메시지로 추가되지 않은 새 댓글 추출
} from "../../../utils/github/issue-messages.js";

// === 메시지 필터링 ===
import { filterHiddenMessages } from "../../../utils/message/filter-hidden.js"; // hidden=true 메시지 제외

// === 상수 ===
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants"; // 렌더링 제외 메시지 ID 접두사

// === 로컬 모드 ===
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 여부 확인

// === 이슈 생성 여부 ===
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // 이슈 생성이 필요한지 확인

/**
 * Planner 그래프 상태 준비 노드
 *
 * @description
 * Planner 그래프의 첫 번째 노드로, GitHub 이슈와 댓글을 불러와서 메시지 상태를 준비합니다.
 * 이전 실행의 요약 메시지는 유지하고, 불필요한 중간 메시지는 제거합니다.
 *
 * 처리 흐름:
 * 1. 로컬 모드 또는 이슈 불필요 시 → 바로 샌드박스 초기화로 이동
 * 2. GitHub 이슈 ID와 리포지토리 검증
 * 3. GitHub에서 이슈와 댓글 병렬로 가져오기
 * 4. 메시지가 없으면 (첫 실행):
 *    - 이슈 본문을 HumanMessage로 추가
 *    - 모든 댓글을 HumanMessage로 추가
 * 5. 메시지가 있으면 (재실행):
 *    - 새로운 댓글만 추적
 *    - 요약이 아닌 AI 메시지 제거 (컨텍스트 절약)
 *    - 이전 태스크 노트를 요약 메시지로 추가
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<Command>} 다음 노드(initialize-sandbox)로 이동하는 Command
 * @throws {Error} 이슈 ID 또는 리포지토리 정보가 없을 때
 * @throws {Error} 이슈를 찾을 수 없을 때
 *
 * @example
 * // Planner 그래프에서 자동 호출
 * // 첫 실행: 이슈 + 모든 댓글을 메시지로 추가
 * // 재실행: 새 댓글만 추가, 요약 메시지 유지
 */
export async function prepareGraphState(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: 로컬 모드 또는 이슈 불필요 시 스킵 ===
  // 로컬 모드이거나 이슈를 생성할 필요가 없으면 바로 샌드박스 초기화로 이동
  if (isLocalMode(config) || !shouldCreateIssue(config)) {
    return new Command({
      update: {},
      goto: "initialize-sandbox",
    });
  }

  // === 2단계: 필수 값 검증 ===
  if (!state.githubIssueId) {
    throw new Error("No github issue id provided");
  }

  if (!state.targetRepository) {
    throw new Error("No target repository provided");
  }

  // === 3단계: GitHub 이슈와 댓글 가져오기 ===
  const { githubInstallationToken } = getGitHubTokensFromConfig(config);
  const baseGetIssueInputs = {
    owner: state.targetRepository.owner,
    repo: state.targetRepository.repo,
    issueNumber: state.githubIssueId,
    githubInstallationToken,
  };

  // 이슈와 댓글을 병렬로 가져오기 (성능 최적화)
  const [issue, comments] = await Promise.all([
    getIssue(baseGetIssueInputs),
    getIssueComments({
      ...baseGetIssueInputs,
      filterBotComments: true, // 봇 댓글 제외 (Open SWE 자신의 댓글)
    }),
  ]);

  if (!issue) {
    throw new Error(`Issue not found. Issue ID: ${state.githubIssueId}`);
  }

  // === 4단계: 첫 실행 - 모든 댓글을 메시지로 추가 ===
  // 메시지가 없으면 처음 실행하는 것이므로 이슈 + 모든 댓글을 HumanMessage로 변환
  if (!state.messages?.length) {
    const commandUpdate: PlannerGraphUpdate = {
      messages: [
        // 이슈 본문을 첫 번째 HumanMessage로 추가
        new HumanMessage({
          id: uuidv4(),
          content: getMessageContentFromIssue(issue),
          additional_kwargs: {
            githubIssueId: state.githubIssueId,
            isOriginalIssue: true, // 원본 이슈 본문임을 표시
          },
        }),
        // 모든 댓글을 HumanMessage로 추가
        ...(comments ?? []).map(
          (comment) =>
            new HumanMessage({
              id: uuidv4(),
              content: getMessageContentFromIssue(comment),
              additional_kwargs: {
                githubIssueId: state.githubIssueId,
                githubIssueCommentId: comment.id, // 댓글 ID 저장 (중복 방지)
              },
            }),
        ),
      ],
    };
    return new Command({
      update: commandUpdate,
      goto: "initialize-sandbox",
    });
  }

  // === 5단계: 재실행 - 새 댓글만 추가, 불필요한 메시지 제거 ===

  // 5-1. 아직 추적되지 않은 새 댓글만 추출
  const untrackedComments = getUntrackedComments(
    state.messages,
    state.githubIssueId,
    comments ?? [],
  );

  // 5-2. 요약이 아닌 AI 메시지 제거 (컨텍스트 절약)
  // - summaryMessage가 아니고
  // - hidden이 아니고
  // - HumanMessage가 아닌 메시지들을 제거
  const removedNonSummaryMessages = filterHiddenMessages(state.messages)
    .filter((m) => !m.additional_kwargs?.summaryMessage && !isHumanMessage(m))
    .map((m: BaseMessage) => new RemoveMessage({ id: m.id ?? "" }));

  // 5-3. 이전 태스크 노트를 요약 메시지로 추가
  // TODO: UI에 "Previous Task Notes" 컴포넌트 추가하여 사용자에게 표시
  const summaryMessage = state.contextGatheringNotes
    ? new AIMessage({
        id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
        content: `Here are the notes taken while planning for the previous task:\n${state.contextGatheringNotes}`,
        additional_kwargs: {
          summaryMessage: true, // 요약 메시지로 표시 (제거되지 않음)
        },
      })
    : undefined;

  // 5-4. Command 업데이트 준비
  const commandUpdate: PlannerGraphUpdate = {
    messages: [
      ...removedNonSummaryMessages, // 불필요한 메시지 제거 명령
      ...(summaryMessage ? [summaryMessage] : []), // 요약 메시지 추가
      ...untrackedComments, // 새 댓글 추가
    ],
    // contextGatheringNotes는 이제 summaryMessage에 포함되었으므로 초기화
    contextGatheringNotes: "",
  };

  // === 6단계: 다음 노드로 이동 ===
  return new Command({
    update: commandUpdate,
    goto: "initialize-sandbox",
  });
}
