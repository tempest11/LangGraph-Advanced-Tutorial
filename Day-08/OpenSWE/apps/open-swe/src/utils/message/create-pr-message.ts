/**
 * @file create-pr-message.ts
 * @description
 * GitHub Pull Request 생성 관련 메시지를 구성하는 유틸리티 함수들을 제공합니다.
 * PR이 성공적으로 생성되었을 때 LangChain 메시지 히스토리에 추가할 메시지를 생성합니다.
 *
 * 주요 기능:
 * - PR URL 생성
 * - AI 메시지 + Tool 메시지 쌍 생성
 * - Draft PR 지원
 */

import { v4 as uuidv4 } from "uuid";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { createOpenPrToolFields } from "@openswe/shared/open-swe/tools";
import { z } from "zod";
import { TargetRepository } from "@openswe/shared/open-swe/types";

/**
 * GitHub Pull Request URL을 생성합니다.
 *
 * @description
 * 저장소 정보와 PR 번호를 사용하여 GitHub PR 페이지의 전체 URL을 구성합니다.
 *
 * @param targetRepository - 대상 저장소 정보 (owner, repo)
 * @param number - PR 번호
 * @returns 생성된 PR의 전체 URL
 *
 * @example
 * const url = constructPullRequestUrl(
 *   { owner: "facebook", repo: "react" },
 *   12345
 * );
 * // "https://github.com/facebook/react/pull/12345"
 */
function constructPullRequestUrl(
  targetRepository: TargetRepository,
  number: number,
) {
  return `https://github.com/${targetRepository.owner}/${targetRepository.repo}/pull/${number}`;
}

/**
 * Pull Request 생성에 대한 도구 호출 메시지 쌍을 생성합니다.
 *
 * @description
 * PR이 성공적으로 생성되었을 때 메시지 히스토리에 추가할 AI 메시지와 Tool 메시지를 생성합니다.
 * LangGraph 워크플로우에서 PR 생성 액션을 기록하는 데 사용됩니다.
 *
 * 생성되는 메시지:
 * 1. **AIMessage**: `open_pr` 도구를 호출하는 AI 메시지 (빈 content)
 * 2. **ToolMessage**: 도구 실행 결과를 담은 메시지 (PR URL 포함)
 *
 * @param targetRepository - 대상 저장소 정보
 * @param number - 생성된 PR 번호
 * @param isDraft - Draft PR 여부 (선택, 기본값: false)
 * @returns [AIMessage, ToolMessage] 형태의 메시지 쌍
 *
 * @example
 * const messages = createPullRequestToolCallMessage(
 *   { owner: "myorg", repo: "myrepo" },
 *   42,
 *   true  // Draft PR
 * );
 * // messages[0] → AIMessage with tool_calls
 * // messages[1] → ToolMessage with "Opened draft pull request: ..."
 */
export function createPullRequestToolCallMessage(
  targetRepository: TargetRepository,
  number: number,
  isDraft?: boolean,
): BaseMessage[] {
  const openPrTool = createOpenPrToolFields();
  const openPrToolArgs: z.infer<typeof openPrTool.schema> = {
    title: "",
    body: "",
  };
  const toolCallId = uuidv4();
  return [
    new AIMessage({
      id: uuidv4(),
      content: "",
      tool_calls: [
        {
          name: openPrTool.name,
          args: openPrToolArgs,
          id: toolCallId,
        },
      ],
    }),
    new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCallId,
      content: `${isDraft ? "Opened draft" : "Opened"} pull request: ${constructPullRequestUrl(targetRepository, number)}`,
      name: openPrTool.name,
      status: "success",
    }),
  ];
}
