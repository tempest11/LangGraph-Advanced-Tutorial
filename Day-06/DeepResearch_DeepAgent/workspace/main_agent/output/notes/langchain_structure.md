# LangChain v1.0 프로젝트 구조 및 전체 아키텍처 변경점

## 개요
LangChain v1.0은 에이전트 기반 AI 파이프라인 구축을 위한 주요 리팩토링과 모듈화, API 및 내부 구조의 대대적인 변화를 도입한 릴리즈입니다. 공식 릴리즈 노트와 마이그레이션 가이드, 개발팀의 블로그에 따르면 v1.0은 개발자 경험, 안정성, 확장성을 크게 강화했습니다.[1][2][3][4][5]

## 1. 프로젝트 구조/모듈화의 변화
- **코어와 레거시 분리:** v1.0은 에이전트(Agent)와 체인(Chain) 중심의 lean한 코어 패키지(`langchain`)로 개편되고, 기존 기능 및 호환성 지원은 별도 `langchain_classic`/`@langchain/classic` 패키지로 이전되었습니다. 이로써 핵심 구조가 명확해지고, 코드베이스가 경량화되었습니다.[3][4][5]
- **신규 중앙 에이전트 추상화:** 모든 에이전트 기능은 이제 새로운 `createAgent` API를 중심으로 통합되었으며, 이는 다양한 AI 모델/벤더 및 툴 통합을 위한 확장성 있는 구조를 제공합니다.[1][3][4][5]
- **미들웨어 아키텍처 도입:** 미들웨어를 통한 행동 전후 훅, 콘텍스트 동적 요약, Human-in-the-loop, 툴 접근 제어, 프롬프트 구성 등 고수준 로직을 쉽게 삽입 및 조합할 수 있게 됐습니다.[1][3][4][5]
- **모듈/서브패키지 체계 강화:** 외부 모델, 툴, 통합 패키지가 각기 별도 모듈로 관리되어, 의존성과 확장성, 유지보수가 용이해졌습니다. 예: OpenAI, AWS, Vertex AI 등 각종 벤더별 인터페이스가 업데이트되어 호환성을 높였습니다.[3][4]

## 2. 내부 아키텍처 및 API 구조의 주요 변경점

### Agent 생성 방식의 통일
- `createAgent` API로 에이전트 생성을 일원화(이전의 `createReactAgent` 등 파편화된 방식 → 단일 진입점)
- 시스템 프롬프트 지정, 모델 및 툴 연결, 미들웨어 결합을 하나의 선언적 인터페이스에서 처리

> "createAgent is the new standard way to build agents in LangChain 1.0. It provides a simpler interface ... while offering greater customization potential through middleware."[3][4][5]

### 미들웨어 기반 커스텀 로직 삽입
- before/after model, tool hooks, 동적 프롬프트, 토큰 스트리밍, 콘텍스트 요약, 오류 처리 등 미들웨어 체계로 구현
- 미들웨어 조합만으로 고유 에이전트 로직 확장 가능

### 컨텐츠 블록(Content Blocks) 도입
- provider-agnostic(벤더 독립적) 컨텐츠 표현: reasoning, selective tool call, citing, multimodal(텍스트+이미지 혼합) 지원
- 이전 버전의 프롬프트 매핑/구조화 출력 패턴보다 더 통합되고, 에이전트 루프 내부에서 직접 structured output 생성(성능/비용 개선)

### 메시지/입출력 시스템 표준화
- 각 메시지(`Message`)에 contentBlocks 필드 추가; 응답 구조를 다양한 벤더와 포맷에 강건하게 매핑
- 스트리밍, 시간 여행(Time travel) 기능 등 최신 인터랙티브/대화형 기능 내장

> "Structured output is now generated in the main loop instead of requiring an additional LLM call."[4][5]

### 이 외 변화 및 마이그레이션
- 레거시 기능 제거 → `langchain_classic`에서만 사용 가능
- 모든 주요 LangChain 패키지 Node 20+ 필요 (JS/TS 기준)
- 에이전트 관련 API의 일부가 완전히 폐기되고 미들웨어+컨텐츠 블록 패턴으로 대체됨
- 에이전트 영속성(체크포인트), 대화 상태 관리, 편리한 마이그레이션 가이드 공식 제공[4][5]

## 3. 기존 버전 대비 주요 구조적 변화의 의미
- **직관성 및 유지관리성 대폭 향상:** 단일 API 및 명확한 구조 도입으로 대규모 프로젝트의 도입/확장 쉬움
- **모듈성/확장성 증대:** 미들웨어 체계, 콘텐츠 블록 등으로 커스텀 로직과 멀티모달 처리, 다양한 벤더 연동 구현 용이
- **레거시 호환성 보장 및 점진적 이전 가능:** classic 패키지로 레거시 기능 이관되어 개발자의 연착륙(or 단계적 이전) 지원
- **LLM 커뮤니티 전반의 추세 반영:** provider-agnostic 메시지 모델 및 미들웨어 패턴은 최신 LLM 프레임워크의 설계 방향과도 일치

## 4. 공식 출처
- [1] [LangChain v1 Just BLEW MY MIND (YouTube)](https://www.youtube.com/watch?v=G-HL5mRyYQc)
- [2] [LangChain 1.0alpha Release Announcement (LinkedIn)](https://www.linkedin.com/posts/langchain_langchain-langgraph-10alpha-releases-activity-7368700669073027072-KQ8b)
- [3] [langchain Changelog & Release Notes](https://data.safetycli.com/packages/pypi/langchain/changelog)
- [4] [공식 v1 변경사항 요약 및 Migration Guide](https://docs.langchain.com/oss/javascript/releases/langchain-v1)
- [5] [v1 마이그레이션 가이드 (Docs)](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)