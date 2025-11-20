# LangChain 및 LangGraph V1.0 주요 기능 변화 및 통합 요약

> 공식 문서·배포 블로그와 마이그레이션 가이드 기반, 2025년 10~11월 최신 내용 기준

---

## 1. LangChain v1.0 주요 변화 요약

- **단일화된 agent abstraction:**
  - 기존 여러 agent/chain 추상화(deprecated) → `create_agent` API로 단일화 [출처: Microsoft Community Hub](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/langchain-v1-is-now-generally-available), [공식 가이드](https://docs.langchain.com/oss/python/migrate/langchain-v1), [공식 블로그](https://blog.langchain.com/langchain-langgraph-1dot0/)
  - 모든 파이프라인 및 실행 흐름이 LangGraph 기반의 고수준 abstraction으로 통합

- **API 대대적 단순화 및 패키지 구조 변경:**
  - 핵심(agents, messages, tools, models, embeddings)만 `langchain` 네임스페이스에 존치, 기존 레거시 체인/모듈은 `langchain-classic`(또는 향후 `langchain-legacy`)로 이전 [공식 가이드](https://docs.langchain.com/oss/python/migrate/langchain-v1)
  - 관련 import 경로 및 사용법 변경 유의

- **Content Block 기반 메시지 표준화:**
  - LLM API/Human/Tool 응답의 출력이 모두 content block(문자, reasoning, citation, tool call 등)으로 표준화
  - 모델과 툴, 프롬프트에 관계없이 구조화된 데이터, 멀티모달(텍스트/이미지/비디오 등) 지원 강화 [출처: Microsoft Community Hub](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/langchain-v1-is-now-generally-available), [공식 블로그](https://blog.langchain.com/langchain-langgraph-1dot0/)

- **Middleware 시스템 도입:**
  - 기존 pre/post model call hook, custom step 등은 미들웨어 후크로 통합됨
  - human approval, summarization, PII redaction 등 다양한 중간 step을 손쉽게 삽입 가능 [공식 블로그](https://blog.langchain.com/langchain-langgraph-1dot0/), [유튜브리뷰](https://www.youtube.com/watch?v=G-HL5mRyYQc)

- **향상된 사용성 및 타입 안정성:**
  - 코드베이스와 API 명세가 더 명확해지고, 체계적인 타입 안정성/type hinting이 도입됨
  - Custom agent state는 오로지 TypedDict로만 정의(기존의 Pydantic/dataclass 방식 제거) [공식 가이드](https://docs.langchain.com/oss/python/migrate/langchain-v1)

- **마이그레이션 및 레거시 지원:**
  - 기존 v0 체인/에이전트 등은 `langchain-classic` 패키지에서 사용 가능, 지원은 계속되나 신규 개발은 v1 권장

- **기타 구조적 개선점:**
  - 동적 프롬프트 생성 및 시스템 프롬프트 인터페이스 개선(이전의 `prompt` → `system_prompt`)
  - 멀티모달 작업 지원 강화, 메시지 content 명확화
  - Python 3.10+만 지원, 3.9는 EOL로 종료 [공식 가이드](https://docs.langchain.com/oss/python/migrate/langchain-v1)

---

## 2. LangGraph v1.0 주요 변화 및 연계점

- **내부적으로 LangChain v1의 agent/oschestrator 런타임 실행 엔진 역할**
- **Graph 기반 워크플로우 제어:** Durable state, checkpointing(중간상태 저장), persistence(서버 재시작 시 이어받기) 강화 [출처: 공식 릴리즈노트](https://docs.langchain.com/oss/python/releases/langgraph-v1)
- 기존 create_react_agent 등 프리빌트 API는 deprecated, LangChain의 `create_agent` API로 통합
- 개발자 입장에서 복잡한 대화형/생성형 AI 워크플로를 안정적이고 쉽게 설계 가능, human-in-the-loop, streaming 등 1st-class 지원

---

## 3. 제거·변경·통합된 주요 기능 및 API(마이그레이션 관점)

- 기존의 chain/agent abstraction(예: create_react_agent, AgentState, HumanInterrupt 등)은 deprecated 및 제거
- Legacy 패턴/모듈(기존 체인, 일부 프롬프트 및 툴)을 `langchain-classic`으로 분리
- Pydantic/dataclass custom state 미지원, 반드시 TypedDict로 작성 필요
- 프롬프트/훅 시스템이 미들웨어 패턴으로 일원화
- 파이썬 3.9(EOL) 지원 중단
- 메시지 처리에서 block 기반 일원화
- 대다수 legacy API, signature 변경/이동됨에 따라 경로 및 인터페이스 확인 필요

---

## 4. 주요 사용성 개선 및 워크플로우 통합 사례

- Agent 빌딩이 10~12줄 코드 수준으로 간소화(모델, 툴, 프롬프트 지정 및 바로 실행) [유튜브리뷰](https://www.youtube.com/watch?v=G-HL5mRyYQc)
- 결괏값 구조가 명확해 프론트엔드, 비즈니스 로직 연계가 매우 쉬워짐
- 미들웨어 체계 도입 → human approval, 요약, 개인정보 제거 등 실무형 커스터마이징 용이
- 멀티프로바이더, 멀티모달, Azure/OpenAI Native 통합 강화

---

## 5. 공식 주요 출처
- [LangChain 1.0 공식 마이그레이션 가이드 (Python)](https://docs.langchain.com/oss/python/migrate/langchain-v1)
- [LangGraph 1.0 공식 릴리즈 노트](https://docs.langchain.com/oss/python/releases/langgraph-v1)
- [마이크로소프트 Azure 발표 블로그](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/langchain-v1-is-now-generally-available)
- [공식 블로그 (통합 요약)](https://blog.langchain.com/langchain-langgraph-1dot0/)
- [YouTube: LangChain v1 Just BLEW MY MIND](https://www.youtube.com/watch?v=G-HL5mRyYQc)