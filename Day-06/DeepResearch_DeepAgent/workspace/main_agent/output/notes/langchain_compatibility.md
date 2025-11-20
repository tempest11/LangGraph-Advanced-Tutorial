# LangChain & LangGraph v1.0 Compatibility and Migration Guide

## 공식 Migration 및 릴리즈 문서 요약

### 핵심 변화 및 주요 개선사항
- **핵심 API 변경**: `create_react_agent` (LangGraph prebuilt) 비공개(deprecated), `create_agent`(LangChain v1)로 대체됨. 
  - 더 단순하고 커스터마이즈가 쉬운 에이전트 생성 방식. 미들웨어(middleware) 기반 확장.
  - [공식 LangGraph v1 릴리즈 노트](https://docs.langchain.com/oss/python/releases/langgraph-v1)
- **미들웨어 시스템 도입**: 프롬프트 동적화, 요약, 선택적 툴 접근, 상태 관리, guardrail 등 다양한 pre/post-model 기능을 미들웨어로 분리, 조합 가능.
- **패키지 구조 단순화**: `langchain` 패키지는 에이전트 핵심 기능(agents, messages, tools, chat_models, embeddings) 위주로 정리. 구버전 체인/리트리버 등은 별도 `langchain-classic`으로 이전됨. (import 경로 변경 필요)
- **표준 Content Blocks**: 주요 API 및 LLM 프러바이더별 통일 메시지 컨텐츠 지원(Reasoning, Citation, Tool Calls, 멀티모달 등).
  - [공식 LangChain v1 변경점](https://docs.langchain.com/oss/python/releases/langchain-v1)
- **파이썬 3.9 지원 종료**: Python 3.10+ 필요. (3.9는 2025년 EOL)
- **중단점/내구성**: 체크포인트, persistence, human-in-the-loop 등 프로그래머블 기능 내장, 런타임은 LangGraph로 유지.

---

## Breaking Changes 및 마이그레이션 세부

- `create_react_agent` -> `create_agent` 변경 필요 (parameter/signature 다름)
- 미들웨어: 프리/포스트 모델 훅을 모두 미들웨어로 구현 (`before_model`, `after_model`)
- agent state 정의에 Pydantic/datataclasses 미지원, 반드시 `TypedDict` 사용
- message 등 일부 클래스/메서드 명칭 및 사용 방식 변경 (e.g. `prompt`→`system_prompt`, ToolNode 예전 방식 미지원)
- 스트리밍 응답: 별도 노드 아닌 메인 루프 수준에서 구조화 output 지원
- [Python Migration 가이드 (공식)](https://docs.langchain.com/oss/python/migrate/langchain-v1)
- [LangGraph v1 Migration 가이드 (공식)](https://docs.langchain.com/oss/python/migrate/langgraph-v1)

> "We generate structured output in the main loop, reducing cost and latency... Pre-model hooks are now implemented as middleware with the `before_model` method." ([Migration Guide](https://docs.langchain.com/oss/python/migrate/langchain-v1))
  
> "The `langchain` package namespace has been significantly reduced in v1... If you were using any of the following from the `langchain` package, you’ll need to install `langchain-classic` and update your imports." ([Migration Guide](https://docs.langchain.com/oss/python/migrate/langchain-v1))

---

## 하위 호환성 및 기타 주요 이슈

- **대부분 기능은 하위 호환**: 핵심 graph primitives(state, node, edge) 및 실행/런타임은 유지. 대다수 코드는 단순 모듈/함수명만 변경하면 작동.
- **구버전 패턴/클래스 제거**: chains, retrievers 등 legacy 기능은 신규 버전에서 직접 지원X → 별도 패키지로 유지·이관 필요.
- **환경 변수, 메시지 직렬화 등**: Content-block 적용/비적용 선택 가능(환경변수로 backwards compatibility 설정)
- **Node.js/JS 경우**: 유사한 breaking changes와 `@langchain/classic` 패키지 분리, Node 20+ 요구.
- [JS Migration Guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)

---

## 사용자 경험 및 커뮤니티 피드백

- Reddit/포럼, GitHub 등에서 다음과 같은 실제 마이그레이션 사례·질문·에러 리포트 확인:
    - **Positive**: "이젠 커스텀 로직/그래프 실행 분리가 훨씬 쉬워졌다. 미들웨어 구조가 관리에 더 용이." ([Reddit](https://www.reddit.com/r/LangChain/comments/1osko4e/langchain_v1_migration/))
    - **Pain Point**: `agentexecutor`, `pydantic` 지원 중단 등에 대한 이슈 빈출 – pydantic 필드/밸리데이션 활용하던 프로젝트는 `TypedDict`로 스키마 재구현 필요 ([LangChain Forum](https://forum.langchain.com/t/migrating-to-langchain-v1/2218)).
    - **Checkpointer/State persistence**: `langgraph dev`는 디폴트로 메모리 상태만 지원, 고급 persistent state는 별도 platform에 배포 필수([LangChain Forum](https://forum.langchain.com/t/langchain-1-0-alpha-feedback-wanted/1436)).
    - **에러/비호환**: 예전 import (`langchain.load` 등) 사용 혹은 CopilotKit 등 외부 패키지와의 interop 문제 리포트. ([GitHub Issue](https://github.com/CopilotKit/CopilotKit/issues/2633))
    - **Migration 조언**: 대부분은 공식 마이그레이션 표/코드예제 참고, 미묘한 차이(메서드/시그니처/Type 변경)로 인해 자체 호환성 layer 구현 사례도 존재.

---

## 참고자료 목록
- [LangChain v1 릴리즈 노트](https://docs.langchain.com/oss/python/releases/langchain-v1)
- [LangChain v1 Migration Guide (Python)](https://docs.langchain.com/oss/python/migrate/langchain-v1)
- [LangGraph v1 릴리즈 노트](https://docs.langchain.com/oss/python/releases/langgraph-v1)
- [LangGraph v1 Migration Guide](https://docs.langchain.com/oss/python/migrate/langgraph-v1)
- [Reddit: LangChain v1 Migration 사례](https://www.reddit.com/r/LangChain/comments/1osko4e/langchain_v1_migration/)
- [LangChain Forum: Migration Q&A](https://forum.langchain.com/t/migrating-to-langchain-v1/2218)
- [GitHub CopilotKit 이슈](https://github.com/CopilotKit/CopilotKit/issues/2633)
