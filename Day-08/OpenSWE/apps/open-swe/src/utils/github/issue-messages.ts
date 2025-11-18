/**
 * @file GitHub 이슈 메시지 변환 유틸리티
 * @description
 * GitHub 이슈와 댓글을 LangChain HumanMessage로 변환하는 유틸리티.
 * 새로운 댓글을 찾아 대화 히스토리에 추가합니다.
 *
 * 주요 기능:
 * 1. 추적되지 않은 댓글 찾기
 * 2. GitHub 이슈/댓글 → HumanMessage 변환
 * 3. 이슈 제목/본문 추출 (XML 태그)
 * 4. Agent Context details 태그 처리
 */

import { v4 as uuidv4 } from "uuid";
import {
  BaseMessage,
  HumanMessage,
  isHumanMessage,
} from "@langchain/core/messages";
import { GitHubIssue, GitHubIssueComment } from "./types.js";
import { getIssue, getIssueComments } from "./api.js";
import { GraphConfig, TargetRepository } from "@openswe/shared/open-swe/types";
import { getGitHubTokensFromConfig } from "../github-tokens.js";
import { DETAILS_CLOSE_TAG, DETAILS_OPEN_TAG } from "./issue-task.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

/**
 * 추적되지 않은 GitHub 댓글들을 HumanMessage로 변환합니다.
 *
 * @param {BaseMessage[]} existingMessages - 기존 메시지 히스토리
 * @param {number} githubIssueId - 이슈 번호
 * @param {GitHubIssueComment[]} comments - GitHub 댓글 배열
 * @returns {BaseMessage[]} 새로운 HumanMessage 배열
 */
export function getUntrackedComments(
  existingMessages: BaseMessage[],
  githubIssueId: number,
  comments: GitHubIssueComment[],
): BaseMessage[] {
  // Get all human messages which contain github comment content. Exclude the original issue message.
  const humanMessages = existingMessages.filter(
    (m) => isHumanMessage(m) && !m.additional_kwargs?.isOriginalIssue,
  );
  // Iterate over the comments, and filter out any comment already tracked by a message.
  // Then, map to create new human message(s).
  const untrackedCommentMessages = comments
    .filter(
      (c) =>
        !humanMessages.some(
          (m) => m.additional_kwargs?.githubIssueCommentId === c.id,
        ),
    )
    .map(
      (c) =>
        new HumanMessage({
          id: uuidv4(),
          content: getMessageContentFromIssue(c),
          additional_kwargs: {
            githubIssueId,
            githubIssueCommentId: c.id,
          },
        }),
    );

  return untrackedCommentMessages;
}

type GetMissingMessagesInput = {
  messages: BaseMessage[];
  githubIssueId: number;
  targetRepository: TargetRepository;
};

/**
 * GitHub 이슈에서 누락된 메시지들을 가져옵니다.
 *
 * @param {GetMissingMessagesInput} input - 입력 파라미터
 * @param {GraphConfig} config - 그래프 설정
 * @returns {Promise<BaseMessage[]>} 누락된 메시지 배열
 */
export async function getMissingMessages(
  input: GetMissingMessagesInput,
  config: GraphConfig,
): Promise<BaseMessage[]> {
  if (isLocalMode(config)) {
    return [];
  }

  const { githubInstallationToken } = getGitHubTokensFromConfig(config);
  const [issue, comments] = await Promise.all([
    getIssue({
      owner: input.targetRepository.owner,
      repo: input.targetRepository.repo,
      issueNumber: input.githubIssueId,
      githubInstallationToken,
    }),
    getIssueComments({
      owner: input.targetRepository.owner,
      repo: input.targetRepository.repo,
      issueNumber: input.githubIssueId,
      githubInstallationToken,
      filterBotComments: true,
    }),
  ]);
  if (!issue && !comments?.length) {
    return [];
  }

  const isIssueMessageTracked = issue
    ? input.messages.some(
        (m) =>
          isHumanMessage(m) &&
          m.additional_kwargs?.isOriginalIssue &&
          m.additional_kwargs?.githubIssueId === input.githubIssueId,
      )
    : false;
  let issueMessage: HumanMessage | null = null;
  if (issue && !isIssueMessageTracked) {
    issueMessage = new HumanMessage({
      id: uuidv4(),
      content: getMessageContentFromIssue(issue),
      additional_kwargs: {
        githubIssueId: input.githubIssueId,
        isOriginalIssue: true,
      },
    });
  }

  const untrackedCommentMessages = comments?.length
    ? getUntrackedComments(input.messages, input.githubIssueId, comments)
    : [];

  return [...(issueMessage ? [issueMessage] : []), ...untrackedCommentMessages];
}

/** 기본 이슈 제목 */
export const DEFAULT_ISSUE_TITLE = "New Open SWE Request";
/** 이슈 제목 XML 태그 (열기) */
export const ISSUE_TITLE_OPEN_TAG = "<open-swe-issue-title>";
/** 이슈 제목 XML 태그 (닫기) */
export const ISSUE_TITLE_CLOSE_TAG = "</open-swe-issue-title>";
/** 이슈 본문 XML 태그 (열기) */
export const ISSUE_CONTENT_OPEN_TAG = "<open-swe-issue-content>";
/** 이슈 본문 XML 태그 (닫기) */
export const ISSUE_CONTENT_CLOSE_TAG = "</open-swe-issue-content>";

/**
 * 메시지에서 이슈 제목과 본문을 추출합니다.
 * @param {string} content - 메시지 내용
 * @returns {{title: string | null, content: string}} 제목과 본문
 */
export function extractIssueTitleAndContentFromMessage(content: string) {
  let messageTitle: string | null = null;
  let messageContent = content;
  if (
    content.includes(ISSUE_TITLE_OPEN_TAG) &&
    content.includes(ISSUE_TITLE_CLOSE_TAG)
  ) {
    messageTitle = content.substring(
      content.indexOf(ISSUE_TITLE_OPEN_TAG) + ISSUE_TITLE_OPEN_TAG.length,
      content.indexOf(ISSUE_TITLE_CLOSE_TAG),
    );
  }
  if (
    content.includes(ISSUE_CONTENT_OPEN_TAG) &&
    content.includes(ISSUE_CONTENT_CLOSE_TAG)
  ) {
    messageContent = content.substring(
      content.indexOf(ISSUE_CONTENT_OPEN_TAG) + ISSUE_CONTENT_OPEN_TAG.length,
      content.indexOf(ISSUE_CONTENT_CLOSE_TAG),
    );
  }
  return { title: messageTitle, content: messageContent };
}

/**
 * 본문을 이슈 본문 태그로 감쌉니다.
 * @param {string} body - 본문 내용
 * @returns {string} 태그로 감싼 본문
 */
export function formatContentForIssueBody(body: string): string {
  return `${ISSUE_CONTENT_OPEN_TAG}${body}${ISSUE_CONTENT_CLOSE_TAG}`;
}

/**
 * 이슈 본문에서 내용 태그 사이의 텍스트를 추출합니다.
 * @param {string} body - 이슈 본문
 * @returns {string} 추출된 내용
 */
function extractContentFromIssueBody(body: string): string {
  if (
    !body.includes(ISSUE_CONTENT_OPEN_TAG) ||
    !body.includes(ISSUE_CONTENT_CLOSE_TAG)
  ) {
    return body;
  }

  return body.substring(
    body.indexOf(ISSUE_CONTENT_OPEN_TAG) + ISSUE_CONTENT_OPEN_TAG.length,
    body.indexOf(ISSUE_CONTENT_CLOSE_TAG),
  );
}

/**
 * 이슈 본문에서 details 태그를 제외하고 내용을 추출합니다.
 * @param {string} body - 이슈 본문
 * @returns {string} details 제외 내용
 */
export function extractContentWithoutDetailsFromIssueBody(
  body: string,
): string {
  if (!body.includes(DETAILS_OPEN_TAG)) {
    return extractContentFromIssueBody(body);
  }

  const bodyWithoutDetails = extractContentFromIssueBody(
    body.substring(
      body.indexOf(DETAILS_OPEN_TAG) + DETAILS_OPEN_TAG.length,
      body.indexOf(DETAILS_CLOSE_TAG),
    ),
  );
  return bodyWithoutDetails;
}

/**
 * GitHub 이슈 또는 댓글에서 메시지 내용을 생성합니다.
 * @param {GitHubIssue | GitHubIssueComment} issue - 이슈 또는 댓글
 * @returns {string} 포맷된 메시지 내용
 */
export function getMessageContentFromIssue(
  issue: GitHubIssue | GitHubIssueComment,
): string {
  if ("title" in issue) {
    const formattedBody = extractContentWithoutDetailsFromIssueBody(
      issue.body ?? "",
    );
    return `[original issue]\n**${issue.title}**\n${formattedBody}`;
  }
  return `[issue comment]\n${issue.body}`;
}
