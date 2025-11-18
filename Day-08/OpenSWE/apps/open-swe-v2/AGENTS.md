# Open SWE V2 Agent Architecture

이 문서는 `open-swe-v2` 에이전트의 아키텍처, 프로젝트 구조, 그리고 핵심 실행 흐름에 대해 상세히 설명합니다.

## 1. Project Overview

Open SWE V2는 `deepagents` 라이브러리를 기반으로 구축된 자율 코딩 에이전트입니다. 사용자의 소프트웨어 엔지니어링 태스크를 수행하기 위해 설계되었으며, 강력한 보안 및 사용자 승인 메커니즘을 갖추고 있습니다. 에이전트는 LangGraph를 통해 상태를 관리하며, 다양한 도구(Tools)와 전문화된 하위 에이전트(Sub-agents)를 활용하여 복잡한 작업을 해결합니다.

주요 특징은 다음과 같습니다:

- **Human-in-the-Loop (사용자 참여)**: 파일 시스템을 변경하거나 셸 명령을 실행하는 등 민감한 작업을 수행하기 전에 사용자에게 명시적인 승인을 요청합니다.
- **Safety-First Command Execution**: `execute_bash` 명령 실행 전, 외부 LLM(Claude 3.5 Haiku)을 통해 프롬프트 인젝션이나 악성 코드 실행 시도와 같은 위협을 탐지하고 차단합니다.
- **Stateful & Cached Approvals**: 사용자가 한 번 승인한 작업(예: 특정 디렉토리에서의 `npm install`)은 상태에 캐싱되어 동일한 작업을 반복적으로 승인할 필요가 없습니다.
- **Modular & Extensible**: 핵심 로직, 도구, 프롬프트, 상태 관리가 명확하게 분리되어 있어 기능 확장이 용이합니다.

---

## 2. Project Structure

`apps/open-swe-v2/src/` 디렉토리의 각 파일은 다음과 같은 역할을 수행합니다.

- `agent.ts`
  - **역할**: 에이전트의 **메인 진입점(Main Entry Point)** 입니다.
  - **구현 방향**: `createDeepAgent` 팩토리 함수를 사용하여 에이전트의 모든 구성 요소를 조립합니다. 도구, 하위 에이전트, 시스템 프롬프트, 상태 스키마, 그리고 실행 후크(Post-model hook)를 하나로 묶어 완전한 에이전트 인스턴스를 생성하고 내보냅니다.

- `tools.ts`
  - **역할**: 에이전트가 외부 세계와 상호작용할 수 있는 **핵심 기능(Tools)** 을 정의합니다.
  - **구현 방향**: `execute_bash`, `http_request`, `web_search`와 같은 도구들을 구현합니다. 각 도구는 LangChain의 `tool` 데코레이터로 래핑되며, Zod 스키마를 통해 입력 인자의 유효성을 검증합니다. 특히 `execute_bash`는 `command-safety.ts`의 검증 로직을 호출하여 보안을 강화합니다.

- `subagents.ts`
  - **역할**: 코드 리뷰나 테스트 생성과 같이 **전문화된 작업을 위임**받는 하위 에이전트를 정의합니다.
  - **구현 방향**: `codeReviewerAgent`와 `testGeneratorAgent`를 정의합니다. 각 하위 에이전트는 특정 역할을 수행하도록 설계된 고유한 시스템 프롬프트와 제한된 도구 세트를 가집니다. 이를 통해 메인 에이전트는 복잡한 태스크를 전문가에게 위임할 수 있습니다.

- `state.ts`
  - **역할**: 에이전트의 **상태(State) 스키마와 관리 로직**을 정의합니다.
  - **구현 방향**: LangGraph의 `DeepAgentState`를 확장하여 `approved_operations`라는 커스텀 필드를 추가합니다. 이 필드는 사용자가 승인한 작업의 캐시를 저장합니다. `AgentStateHelpers` 클래스는 이 캐시를 관리하기 위한 유틸리티 함수(키 생성, 승인 여부 확인 등)를 제공합니다.

- `prompts.ts`
  - **역할**: 에이전트의 **정체성과 행동 규칙**을 정의하는 시스템 프롬프트를 제공합니다.
  - **구현 방향**: 에이전트의 어조, 스타일, 도구 사용법, 제약 조건 등 모든 지침이 포함된 거대한 템플릿 문자열을 생성하는 `getCodingInstructions` 함수를 구현합니다. 이 프롬프트는 에이전트 행동의 근간이 됩니다.

- `post-model-hook.ts`
  - **역할**: **사용자 승인 워크플로우(Human-in-the-Loop)** 를 구현하는 핵심 로직입니다.
  - **구현 방향**: 모델이 도구 사용을 포함한 응답을 생성한 직후, 그리고 도구가 실제로 실행되기 전에 트리거되는 훅(Hook)을 생성합니다. 이 훅은 `WRITE_COMMANDS` 목록에 포함된 민감한 도구 호출을 가로채고, `interrupt`를 발생시켜 사용자에게 승인을 요청합니다.

- `command-safety.ts`
  - **역할**: 셸 명령어에 대한 **보안 검증(Safety Validation)** 을 수행합니다.
  - **구현 방향**: `validateCommandSafety` 함수는 Anthropic API를 호출하여 주어진 셸 명령어가 악의적인지(예: 프롬프트 인젝션) 분석하도록 요청합니다. LLM의 답변을 구조화된 Zod 스키마(`CommandSafetyValidationSchema`)로 파싱하여 안전 여부를 판단하고, 안전하지 않으면 명령어 실행을 차단합니다.

- `constants.ts`
  - **역할**: 애플리케이션 전반에서 사용되는 **상수(Constants)** 를 정의합니다.
  - **구현 방향**: 사용자 승인이 필요한 명령어 이름들을 `Set` 객체(`FILE_EDIT_COMMANDS`, `WRITE_COMMANDS`)로 정의하고 내보냅니다. 이를 통해 승인 정책을 한 곳에서 관리할 수 있습니다.

- `types.ts`
  - **역할**: 프로젝트에서 사용되는 **핵심 TypeScript 타입과 Zod 스키마**를 정의합니다.
  - **구현 방향**: 명령어 인자, 상태 객체, 승인 키 등과 관련된 타입들을 중앙에서 관리하여 코드 전체의 타입 안정성을 보장합니다.

---

## 3. Core Execution Flow (핵심 실행 흐름)

에이전트의 작업 처리 흐름은 다음과 같은 단계로 이루어지며, 특히 보안과 사용자 승인에 중점을 둡니다.

1.  **Agent Invocation**: 사용자가 프롬프트를 입력하면 `agent.ts`에서 생성된 메인 에이전트가 호출됩니다.

2.  **Model Generation**: 에이전트는 `prompts.ts`의 지침에 따라 사용자의 요청을 분석하고, `tools.ts`나 `subagents.ts`의 기능을 사용하여 해결 계획을 수립합니다. 모델은 하나 이상의 도구 호출(Tool Call)을 포함한 응답을 생성합니다.

3.  **Interception by Post-Model Hook**: 모델의 응답이 생성된 직후, `post-model-hook.ts`의 훅이 실행됩니다. 이 훅은 응답에 포함된 모든 도구 호출을 검사합니다.

4.  **Approval Check**: 훅은 호출된 도구의 이름이 `constants.ts`에 정의된 `WRITE_COMMANDS` 목록에 있는지 확인합니다.
    - **Case A (Approval Not Required)**: 도구가 목록에 없으면 다음 단계로 넘어갑니다.
    - **Case B (Approval Required)**: 도구가 목록에 있으면 `state.ts`의 `AgentStateHelpers.isOperationApproved`를 호출하여 이전에 승인된 작업인지 확인합니다.

5.  **User Interaction (Interrupt)**:
    - 만약 이전에 승인되지 않은 작업이라면, 훅은 LangGraph의 `interrupt` 함수를 호출합니다. 그래프 실행이 일시 중단되고, 사용자에게 해당 명령어를 실행할 것인지 묻는 승인 요청이 표시됩니다.
    - 사용자가 승인하면, `AgentStateHelpers.addApprovedOperation`을 통해 이 승인 사실이 상태에 캐싱되고, 도구 실행이 허용됩니다.
    - 사용자가 거부하면, 해당 도구 호출은 무시되고 에이전트는 다음 작업을 시도합니다.

6.  **Tool Execution & Safety Validation**:
    - 승인된 도구 호출이 `execute_bash`인 경우, `tools.ts`의 `executeBash` 함수가 실행됩니다.
    - `executeBash`는 실제 명령어를 실행하기 **전에** `command-safety.ts`의 `validateCommandSafety` 함수를 호출합니다.
    - `validateCommandSafety`는 외부 LLM을 통해 명령어가 안전한지 최종 검증합니다. 여기서 위협이 탐지되면 명령어는 즉시 차단되고 에러가 반환됩니다.

7.  **Return Result**: 도구 실행 결과(성공, 실패, stdout, stderr)가 에이전트에게 반환됩니다.

8.  **Loop Continuation**: 에이전트는 도구 실행 결과를 바탕으로 다음 단계를 계획하며, 작업이 완료될 때까지 이 루프를 반복합니다.
