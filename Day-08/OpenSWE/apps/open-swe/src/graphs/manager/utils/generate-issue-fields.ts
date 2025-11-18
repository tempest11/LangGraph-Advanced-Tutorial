/**
 * @file GitHub 이슈 필드 생성 유틸리티
 * @description
 * 대화 히스토리에서 LLM을 사용하여 GitHub 이슈의 제목과 본문을 자동 생성합니다.
 *
 * 주요 기능:
 * 1. 대화 메시지 분석 및 요약
 * 2. LLM 도구 호출을 통한 구조화된 이슈 필드 추출
 * 3. 간결하고 명확한 이슈 제목 및 설명 생성
 *
 * 사용 시나리오:
 * - 사용자가 CLI를 통해 작업을 요청할 때 자동으로 GitHub 이슈 생성
 * - 대화 내용을 바탕으로 이슈를 자동 문서화
 */

// LangChain 메시지 기본 타입
import { BaseMessage } from "@langchain/core/messages";

// 그래프 설정 타입 (LLM 모델 선택 등)
import { GraphConfig } from "@openswe/shared/open-swe/types";

// Zod 스키마 라이브러리 (타입 검증 및 도구 스키마 정의용)
import { z } from "zod";

// LLM 모델 로드 및 병렬 도구 호출 지원 확인 함수
import {
  loadModel,                     // 설정에 맞는 LLM 모델 인스턴스 로드
  supportsParallelToolCallsParam, // 모델이 병렬 도구 호출을 지원하는지 확인
} from "../../../utils/llms/index.js";

// LLM 작업 타입 열거형 (어떤 용도로 LLM을 사용할지 정의)
import { LLMTask } from "@openswe/shared/open-swe/llm-task";

// 메시지 객체를 문자열로 변환하는 유틸리티
import { getMessageString } from "../../../utils/message/content.js";

/**
 * 대화 메시지 히스토리에서 GitHub 이슈 제목과 본문을 생성하는 함수
 *
 * @description
 * LLM을 사용하여 사용자와의 대화 내용을 분석하고, 적절한 GitHub 이슈의
 * 제목과 본문을 자동으로 생성합니다. 이 함수는 주로 CLI 모드에서 사용되어
 * 사용자 요청을 GitHub 이슈 형태로 변환합니다.
 *
 * 처리 흐름:
 * 1. ROUTER 작업용 LLM 모델 로드
 * 2. GitHub 이슈 생성 도구 스키마 정의
 * 3. 대화 히스토리를 프롬프트로 변환
 * 4. LLM에게 도구 호출 강제 (tool_choice)
 * 5. 생성된 제목과 본문 반환
 *
 * @param {BaseMessage[]} messages - 분석할 대화 메시지 배열
 *   - HumanMessage, AIMessage 등이 포함될 수 있음
 *   - 주로 HumanMessage의 내용이 이슈 생성에 활용됨
 *
 * @param {GraphConfig["configurable"]} configurable - 그래프 설정 객체
 *   - LLM 모델 선택 및 인증 정보 포함
 *   - 런타임 환경 설정
 *
 * @returns {Promise<{ title: string; body: string }>} 생성된 이슈 필드
 *   - title: 간결하고 명확한 이슈 제목
 *   - body: 대화 내용을 요약한 이슈 본문 (과도한 설명 제외)
 *
 * @throws {Error} LLM이 도구를 호출하지 않았을 때
 *
 * @example
 * const messages = [
 *   new HumanMessage("로그인 버튼이 작동하지 않습니다"),
 *   new AIMessage("어떤 브라우저를 사용하시나요?"),
 *   new HumanMessage("Chrome입니다")
 * ];
 * const result = await createIssueFieldsFromMessages(messages, configurable);
 * // result = {
 * //   title: "로그인 버튼 작동 오류 (Chrome)",
 * //   body: "Chrome 브라우저에서 로그인 버튼이 작동하지 않는 문제"
 * // }
 */
export async function createIssueFieldsFromMessages(
  messages: BaseMessage[],
  configurable: GraphConfig["configurable"],
): Promise<{ title: string; body: string }> {
  // === 1단계: LLM 모델 로드 ===
  // ROUTER 작업용 모델 로드 (메시지 라우팅 및 분류에 적합한 모델)
  const model = await loadModel({ configurable }, LLMTask.ROUTER);

  // === 2단계: GitHub 이슈 생성 도구 정의 ===
  // LLM이 호출할 수 있는 도구를 Zod 스키마로 정의
  const githubIssueTool = {
    // 도구 이름 (LLM이 인식하는 식별자)
    name: "create_github_issue",

    // 도구 설명 (LLM이 언제 이 도구를 사용해야 하는지 이해하는 데 도움)
    description: "Create a new GitHub issue with the given title and body.",

    // 도구 파라미터 스키마 (제목과 본문의 형식 정의)
    schema: z.object({
      title: z
        .string()
        .describe(
          "The title of the issue to create. Should be concise and clear.",
        ),
      body: z
        .string()
        .describe(
          "The body of the issue to create. This should be an extremely concise description of the issue. You should not over-explain the issue, as we do not want to waste the user's time. Do not include any additional context not found in the conversation history.",
        ),
    }),
  };
  // === 3단계: 모델의 병렬 도구 호출 지원 여부 확인 ===
  // 일부 모델은 여러 도구를 동시에 호출할 수 있음
  // 이 플래그를 통해 모델의 기능을 확인하고 적절히 설정
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    { configurable },
    LLMTask.ROUTER,
  );

  // === 4단계: 모델에 도구 바인딩 및 설정 ===
  const modelWithTools = model
    // 도구 배열을 모델에 바인딩
    .bindTools([githubIssueTool], {
      // tool_choice: 특정 도구를 반드시 호출하도록 강제
      // 이렇게 하면 LLM이 항상 create_github_issue 도구를 호출하게 됨
      tool_choice: githubIssueTool.name,

      // 모델이 병렬 도구 호출을 지원하면 명시적으로 비활성화
      // (이슈는 하나씩만 생성해야 하므로 병렬 호출 불필요)
      ...(modelSupportsParallelToolCallsParam
        ? {
            parallel_tool_calls: false,
          }
        : {}),
    })
    // 실행 설정 추가
    .withConfig({
      tags: ["nostream"],              // 스트리밍 비활성화 (전체 응답 대기)
      runName: "create-issue-fields",  // LangSmith 추적용 실행 이름
    });

  // === 5단계: LLM 프롬프트 구성 ===
  // 대화 히스토리를 분석하여 이슈를 생성하도록 지시하는 프롬프트
  const prompt = `You're an AI programmer, tasked with taking the conversation history provided below, and creating a new GitHub issue.
Ensure the issue title and body are both clear and concise. Do not hallucinate any information not found in the conversation history.
You should mainly be looking at the human messages as context for the issue.

# Conversation History
${messages.map(getMessageString).join("\n")}

With the above conversation history in mind, please call the ${githubIssueTool.name} tool to create a new GitHub issue based on the user's request.`;

  // === 6단계: LLM 호출 및 도구 실행 ===
  // 프롬프트를 LLM에 전달하여 도구 호출 요청
  const result = await modelWithTools.invoke([
    {
      role: "user",
      content: prompt,
    },
  ]);

  // === 7단계: 도구 호출 결과 추출 ===
  // LLM이 반환한 도구 호출 정보에서 첫 번째 호출 가져오기
  const toolCall = result.tool_calls?.[0];

  // 도구 호출이 없으면 에러 (tool_choice로 강제했으므로 발생하지 않아야 함)
  if (!toolCall) {
    throw new Error("No tool call found in result");
  }

  // 도구 호출 인자(제목과 본문)를 타입 안전하게 반환
  return toolCall.args as z.infer<typeof githubIssueTool.schema>;
}
