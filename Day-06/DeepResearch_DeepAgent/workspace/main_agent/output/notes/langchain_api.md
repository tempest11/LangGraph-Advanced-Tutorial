# LangChain v1.0 API 변경점 요약 및 마이그레이션 가이드

## 주요 변경점 요약
- **패키지 및 네임스페이스 개편**: 대부분의 기본 API와 모듈이 `langchain` 네임스페이스로 단순화. 기존 레거시 API는 `langchain-classic`에 위치함. ([Migration Guide](https://docs.langchain.com/oss/python/migrate/langchain-v1))
- **Python 3.9 지원 중단**: 최소 Python 3.10 이상 필요.
- **`create_agent` 도입**: 에이전트 생성의 기본 API가 `create_agent`로 통합. 기존 `create_react_agent` 등은 deprecated/삭제됨. ([LangGraph v1 Guide](https://docs.langchain.com/oss/python/migrate/langgraph-v1), [Changelog](https://changelog.langchain.com/announcements/langgraph-1-0-is-now-generally-available))
- **미들웨어 패턴 도입**: 프리/포스트 훅(hook) 패턴 폐지. 미들웨어(`before_model`, `after_model` 등)로 커스텀 동작 처리.
  - 미들웨어는 프롬프트 생성, 툴 호출 이전 및 이후, 모델 호출 전후 등 다양한 단계에서 동작 지정 가능.
- **프롬프트 파라미터 명 변경**: `prompt` → `system_prompt` 등으로 명확화, 동적 프롬프트에서도 활용.
- **State/Schema 표준화**: 에이전트의 상태(State)를 명시적으로 타입(TypedDict 등)으로 정의, `state_schema`를 통해 전달.
- **OpenAI/프롬프트 응답 포맷 표준화**: Content Block 기반 I/O, 메시지 포맷 명확화, 멀티모달 지원(텍스트/이미지/파일 등).
- **툴/모델 통합 및 입력 자동 검증**: `create_agent`에서 자동 input validation 지원.
- **레거시 코드 통합**: 기존 API(함수/클래스 등)는 `langchain-classic`에서만 사용 가능. 신규 프로젝트는 v1의 표준 패턴 사용 권장.

## 주요 마이그레이션 포인트 및 예시

### 대표 코드 패턴 변화 예시 (Python)

#### (1) 에이전트 생성 패턴 변경
기존(v0.x):
```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    tools=[...],
    prompt="You are a bot.",
    model=llm
)
```

v1.0:
```python
from langchain.agents import create_agent
from langchain.tools import tool
from typing import TypedDict

# State schema 명시적 정의
class MyState(TypedDict):
    query: str
    answer: str

def my_tool(input: str):
    ...

agent = create_agent(
    tools=[my_tool],
    system_prompt="You are a helpful bot.",
    state_schema=MyState
)
```

#### (2) 미들웨어 적용 예시
```python
class MyMiddleware:
    def before_model(self, state, ...):
        # ex) 로깅, 프롬프트 조정
        return state
    def after_model(self, state, ...):
        # ex) 결과 확인/정제
        return state

agent = create_agent(..., middleware=[MyMiddleware()])
```

#### (3) 툴 입력 자동 검증 및 content blocks (표준화 I/O)
- `create_agent`는 입력 타입에 따라 자동 input validation 지원
- 메시지(응답)는 content block 기반 포맷을 통일적으로 사용

#### (4) TypedDict 기반 State 사용 강제
- Pydantic/dataclasses 불가. 반드시 `TypedDict` 규격 사용

자세한 예시는 [Migration Guide (Python)](https://docs.langchain.com/oss/python/migrate/langchain-v1#code-examples)을 참고하세요.

## 주요 deprecated/삭제 항목
- 기존 `langgraph.prebuilt` 계열 API: 사용 중단, `langchain.agents`에서 기능 확장
- `create_react_agent` 등 prebuilt 에이전트 빌더
- Python 3.9 환경
- 레거시 네임스페이스 및 프리/포스트 훅 패턴

## 참고자료 및 릴리즈 노트
- [LangChain v1 Migration Guide (Python)](https://docs.langchain.com/oss/python/migrate/langchain-v1)
- [LangChain v1 Migration Guide (TypeScript)](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)
- [LangGraph v1 Migration Guide](https://docs.langchain.com/oss/python/migrate/langgraph-v1)
- [LangChain/LangGraph 1.0 공식 블로그](https://blog.langchain.com/langchain-langgraph-1dot0/)
- [Changelog & Announcements](https://changelog.langchain.com/announcements/langgraph-1-0-is-now-generally-available)
- [Microsoft Dev Blog](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/langchain-v1-is-now-generally-available/4462159)
