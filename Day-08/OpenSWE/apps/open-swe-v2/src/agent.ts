/**
 * @file agent.ts
 * @description Open SWE V2의 메인 코딩 에이전트를 정의하고 구성하는 핵심 파일입니다.
 * 이 파일은 `deepagents` 라이브러리의 `createDeepAgent` 팩토리 함수를 사용하여,
 * 에이전트의 모든 구성 요소(도구, 하위 에이전트, 시스템 프롬프트, 상태 스키마, 실행 후크)를
 * 하나로 조립하여 완전한 에이전트 인스턴스를 생성하고 내보냅니다.
 * 이 에이전트는 소프트웨어 엔지니어링 작업을 자율적으로 수행하도록 설계되었습니다.
 */

import "@langchain/langgraph/zod";
import { createDeepAgent } from "deepagents";
import { codeReviewerAgent, testGeneratorAgent } from "./subagents.js";
import { getCodingInstructions } from "./prompts.js";
import { createAgentPostModelHook } from "./post-model-hook.js";
import { CodingAgentState } from "./state.js";
import { executeBash, httpRequest, webSearch } from "./tools.js";

// 에이전트의 정체성, 행동 규칙, 어조, 도구 사용법 등 모든 지침이 담긴 시스템 프롬프트를 가져옵니다.
const codingInstructions = getCodingInstructions();

// 모델이 응답을 생성한 직후, 그리고 도구가 실제로 실행되기 전에 트리거되는 훅(Hook)을 생성합니다.
// 이 훅은 'Human-in-the-Loop' 사용자 승인 워크플로우를 구현하는 핵심 로직입니다.
const postModelHook = createAgentPostModelHook();

// `createDeepAgent` 팩토리 함수를 호출하여 메인 에이전트 인스턴스를 생성하고 구성합니다.
const agent = createDeepAgent({
  // 에이전트가 외부 세계(파일 시스템, 네트워크 등)와 상호작용하는 데 사용할 수 있는 핵심 기능(도구) 목록입니다.
  tools: [executeBash, httpRequest, webSearch],

  // 에이전트의 행동과 응답 스타일을 결정하는 기본 시스템 프롬프트입니다.
  instructions: codingInstructions,

  // 코드 리뷰나 테스트 생성과 같이 전문화된 작업을 위임받는 하위 에이전트 목록입니다.
  // 이를 통해 메인 에이전트는 복잡한 태스크를 전문가에게 위임할 수 있습니다.
  subagents: [codeReviewerAgent, testGeneratorAgent],

  // 에이전트가 로컬 파일 시스템에 직접 접근하고 수정할 수 있는 권한을 가짐을 나타냅니다.
  isLocalFileSystem: true,

  // 모델의 응답 생성 후 실행되는 콜백 함수로, 여기서는 사용자 승인 로직을 처리합니다.
  postModelHook: postModelHook,

  // LangGraph 실행 상태를 정의하는 Zod 스키마입니다. `CodingAgentState`는 승인 캐시와 같은 커스텀 필드를 포함합니다.
  stateSchema: CodingAgentState,
  // 에이전트의 재귀 호출 제한을 높은 값(1000)으로 설정하여, 복잡하고 여러 단계에 걸친 작업을 수행할 수 있도록 허용합니다.
}).withConfig({ recursionLimit: 1000 }) as any;

// 생성된 에이전트와 핵심 도구들을 LangGraph 애플리케이션에서 사용할 수 있도록 내보냅니다.
export { agent, executeBash, httpRequest, webSearch };
