/**
 * @file review.ts
 * @description
 * 코드 리뷰 관련 데이터를 추출하고 포맷팅하는 유틸리티 함수들을 제공합니다.
 * Reviewer 그래프에서 생성된 코드 리뷰 결과를 처리하고 프롬프트로 변환합니다.
 *
 * 주요 기능:
 * - 메시지에서 코드 리뷰 정보 추출
 * - 리뷰 프롬프트 포맷팅
 * - 추가 작업 목록 처리
 */

import { BaseMessage, isAIMessage } from "@langchain/core/messages";
import { createCodeReviewMarkTaskNotCompleteFields } from "@openswe/shared/open-swe/tools";
import { z } from "zod";

/**
 * 메시지 배열에서 코드 리뷰 정보를 추출합니다.
 *
 * @description
 * AI 메시지 중 코드 리뷰 도구를 호출한 메시지를 찾아 리뷰 내용과 추가 작업 목록을 추출합니다.
 * Reviewer가 코드를 검토한 후 개선이 필요하다고 판단한 경우 이 정보가 포함됩니다.
 *
 * 추출 로직:
 * 1. AI 메시지 중 마지막 코드 리뷰 도구 호출 찾기
 * 2. 도구 호출 인자에서 review와 additional_actions 추출
 * 3. 둘 다 존재하는 경우에만 반환
 *
 * @param messages - 검색할 메시지 배열
 * @returns 리뷰 내용과 추가 작업 목록 (없으면 null)
 *
 * @example
 * const reviewData = getCodeReviewFields(messages);
 * if (reviewData) {
 *   console.log(reviewData.review);        // 리뷰 내용
 *   console.log(reviewData.newActions);    // ["작업1", "작업2"]
 * }
 */
export function getCodeReviewFields(
  messages: BaseMessage[],
): { review: string; newActions: string[] } | null {
  const codeReviewToolFields = createCodeReviewMarkTaskNotCompleteFields();
  const codeReviewMessage = messages
    .filter(isAIMessage)
    .findLast(
      (m) =>
        m.tool_calls?.length &&
        m.tool_calls.some((tc) => tc.name === codeReviewToolFields.name),
    );
  const codeReviewToolCall = codeReviewMessage?.tool_calls?.find(
    (tc) => tc.name === codeReviewToolFields.name,
  );
  if (!codeReviewMessage || !codeReviewToolCall) return null;
  const codeReviewArgs = codeReviewToolCall.args as z.infer<
    typeof codeReviewToolFields.schema
  >;
  if (!codeReviewArgs.review || !codeReviewArgs.additional_actions?.length)
    return null;

  return {
    review: codeReviewArgs.review,
    newActions: codeReviewArgs.additional_actions,
  };
}

/**
 * 코드 리뷰 프롬프트를 포맷팅합니다.
 *
 * @description
 * 리뷰 프롬프트 템플릿의 placeholder를 실제 리뷰 내용과 추가 작업으로 치환합니다.
 * 템플릿의 `{CODE_REVIEW}`와 `{CODE_REVIEW_ACTIONS}` 부분이 실제 값으로 대체됩니다.
 *
 * Placeholder:
 * - `{CODE_REVIEW}`: 리뷰 내용으로 치환
 * - `{CODE_REVIEW_ACTIONS}`: 추가 작업 목록으로 치환 (불릿 포인트 형식)
 *
 * @param reviewPrompt - 포맷팅할 프롬프트 템플릿
 * @param inputs - 리뷰 데이터 (리뷰 내용, 추가 작업 목록)
 * @returns 포맷팅된 프롬프트 문자열
 *
 * @example
 * const prompt = formatCodeReviewPrompt(
 *   "리뷰: {CODE_REVIEW}\n작업: {CODE_REVIEW_ACTIONS}",
 *   {
 *     review: "변수명 개선 필요",
 *     newActions: ["변수명 수정", "주석 추가"]
 *   }
 * );
 * // "리뷰: 변수명 개선 필요
 * // 작업: * 변수명 수정
 * // * 주석 추가"
 */
export function formatCodeReviewPrompt(
  reviewPrompt: string,
  inputs: {
    review: string;
    newActions: string[];
  },
): string {
  return reviewPrompt
    .replaceAll("{CODE_REVIEW}", inputs.review)
    .replaceAll(
      "{CODE_REVIEW_ACTIONS}",
      inputs.newActions.map((a) => `* ${a}`).join("\n"),
    );
}
