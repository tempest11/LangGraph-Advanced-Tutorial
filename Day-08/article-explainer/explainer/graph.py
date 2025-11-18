"""
파일명: graph.py
설명: LangGraph SWARM 아키텍처의 핵심 구현 파일

SWARM 패턴에서의 역할:
    이 파일은 Multi-Agent 시스템의 전체 구조를 정의합니다.
    5개의 전문 에이전트를 생성하고, 각 에이전트 간 제어 전달(handoff) 메커니즘을 설정하며,
    최종적으로 하나의 통합된 SWARM 시스템으로 컴파일합니다.

주요 구성 요소:
    - Handoff Tools: 에이전트 간 제어를 전달하는 도구들
    - React Agents: 각 전문 영역을 담당하는 5개의 에이전트
    - Swarm: 모든 에이전트를 통합한 다중 에이전트 시스템
    - Compiled Graph: 실행 가능한 LangGraph 애플리케이션

SWARM 패턴의 특징:
    - 동적 협업: 에이전트는 작업 중 다른 에이전트에게 제어를 넘길 수 있음
    - 전문화: 각 에이전트는 특정 역할에 특화되어 있음
    - 상태 공유: 모든 에이전트가 SwarmState를 통해 컨텍스트를 공유
"""

from explainer.prompts import (
    ANALOGY_CREATOR_SYSTEM_PROMPT,
    DEVELOPER_SYSTEM_PROMPT,
    EXPLAINER_SYSTEM_PROMPT,
    SUMMARIZER_SYSTEM_PROMPT,
    VULNERABILITY_EXPERT_SYSTEM_PROMPT,
)
from explainer.service.config import get_chat_model
from langchain.agents import create_agent  # ReAct 패턴 기반 에이전트 생성
from langgraph_swarm import create_handoff_tool, create_swarm  # SWARM 패턴 핵심 함수

# ========================================
# LLM 모델 초기화
# ========================================
# 모든 SWARM 에이전트가 공유할 LLM 모델
# config.py의 get_chat_model()은 환경 변수에 따라 OpenAI 또는 Ollama 모델을 반환
model = get_chat_model()  # 기본값: "openai:gpt-4.1-mini" 또는 로컬 "qwen3:8b"

# ========================================
# Handoff Tools (제어 전달 도구) 정의
# ========================================
# SWARM 패턴의 핵심: 에이전트 간 동적 제어 전달을 위한 도구들
# 각 도구는 특정 에이전트로 제어를 넘기는 역할을 합니다.

transfer_to_developer = create_handoff_tool(
    agent_name="developer",
    description="Tool to hand control to the Developer for code examples and technical implementations.",
)
# Developer 에이전트로 제어를 전달하는 도구
# 사용 시나리오: 코드 예제나 기술적 구현이 필요할 때
transfer_to_summarizer = create_handoff_tool(
    agent_name="summarizer",
    description="Tool to hand control to the Summarizer for concise summaries, key points, and TL;DR responses.",
)
# Summarizer 에이전트로 제어를 전달하는 도구
# 사용 시나리오: 간결한 요약이나 핵심 포인트 추출이 필요할 때
transfer_to_explainer = create_handoff_tool(
    agent_name="explainer",
    description="Tool to hand control to the Explainer for detailed step-by-step breakdowns and educational explanations.",
)
# Explainer 에이전트로 제어를 전달하는 도구
# 사용 시나리오: 단계별 상세 설명이나 교육적 해설이 필요할 때
transfer_to_analogy_creator = create_handoff_tool(
    agent_name="analogy_creator",
    description="Tool to hand control to the Analogy Creator for creating relatable analogies and metaphors for complex concepts.",
)
# Analogy Creator 에이전트로 제어를 전달하는 도구
# 사용 시나리오: 복잡한 개념을 쉬운 비유로 설명해야 할 때
transfer_to_vulnerability_expert = create_handoff_tool(
    agent_name="vulnerability_expert",
    description="Tool to hand control to the Vulnerability Expert for analyzing potential weaknesses in arguments and methodology.",
)
# Vulnerability Expert 에이전트로 제어를 전달하는 도구
# 사용 시나리오: 논증의 약점이나 방법론 분석이 필요할 때

# ========================================
# React Agents (반응형 에이전트) 정의
# ========================================
# ReAct 패턴: Reasoning (추론) + Acting (행동)을 결합한 에이전트 아키텍처
# 각 에이전트는 자신의 전문 영역에 특화되어 있으며, 필요시 다른 에이전트에게 제어를 넘길 수 있습니다.

developer = create_agent(
    model,
    system_prompt=DEVELOPER_SYSTEM_PROMPT,  # Developer 역할 정의 프롬프트
    tools=[
        # Developer가 사용할 수 있는 handoff 도구들
        # 자신을 제외한 모든 에이전트로 제어를 전달할 수 있음
        transfer_to_summarizer,
        transfer_to_explainer,
        transfer_to_analogy_creator,
        transfer_to_vulnerability_expert,
    ],
    name="developer",
)
# Developer 에이전트: 코드 예제 및 기술적 구현을 담당

summarizer = create_agent(
    model,
    system_prompt=SUMMARIZER_SYSTEM_PROMPT,  # Summarizer 역할 정의 프롬프트
    tools=[
        # Summarizer가 사용할 수 있는 handoff 도구들
        transfer_to_developer,
        transfer_to_explainer,
        transfer_to_analogy_creator,
        transfer_to_vulnerability_expert,
    ],
    name="summarizer",
)
# Summarizer 에이전트: 간결한 요약 및 핵심 포인트 추출을 담당

explainer = create_agent(
    model,
    system_prompt=EXPLAINER_SYSTEM_PROMPT,  # Explainer 역할 정의 프롬프트
    tools=[
        # Explainer가 사용할 수 있는 handoff 도구들
        transfer_to_developer,
        transfer_to_summarizer,
        transfer_to_analogy_creator,
        transfer_to_vulnerability_expert,
    ],
    name="explainer",
)
# Explainer 에이전트: 단계별 상세 설명 및 교육적 해설을 담당 (기본 에이전트)

analogy_creator = create_agent(
    model,
    system_prompt=ANALOGY_CREATOR_SYSTEM_PROMPT,  # Analogy Creator 역할 정의 프롬프트
    tools=[
        # Analogy Creator가 사용할 수 있는 handoff 도구들
        transfer_to_developer,
        transfer_to_summarizer,
        transfer_to_explainer,
        transfer_to_vulnerability_expert,
    ],
    name="analogy_creator",
)
# Analogy Creator 에이전트: 복잡한 개념을 쉬운 비유로 설명하는 역할 담당

vulnerability_expert = create_agent(
    model,
    system_prompt=VULNERABILITY_EXPERT_SYSTEM_PROMPT,  # Vulnerability Expert 역할 정의 프롬프트
    tools=[
        # Vulnerability Expert가 사용할 수 있는 handoff 도구들
        transfer_to_developer,
        transfer_to_summarizer,
        transfer_to_explainer,
        transfer_to_analogy_creator,
    ],
    name="vulnerability_expert",
)
# Vulnerability Expert 에이전트: 논증의 약점 및 방법론 분석을 담당

# ========================================
# SWARM 생성 및 컴파일
# ========================================
# 모든 에이전트를 하나의 통합된 다중 에이전트 시스템으로 결합

agent_swarm = create_swarm(
    [
        # SWARM에 포함될 모든 에이전트 리스트
        developer,  # 코드 예제 생성 전문가
        summarizer,  # 요약 전문가
        explainer,  # 상세 설명 전문가 (기본 에이전트)
        analogy_creator,  # 비유 생성 전문가
        vulnerability_expert,  # 취약점 분석 전문가
    ],
    default_active_agent="explainer",  # 초기 활성 에이전트 설정
)
"""
agent_swarm: Swarm 객체

SWARM 다중 에이전트 시스템의 핵심 객체로, 다음 특징을 가집니다:

구조:
    - 5개의 전문 에이전트로 구성 (Developer, Summarizer, Explainer, Analogy Creator, Vulnerability Expert)
    - Full-mesh 토폴로지: 각 에이전트가 다른 모든 에이전트에게 제어를 전달할 수 있음
    - Explainer가 기본 에이전트로 설정 (default_active_agent="explainer")

동작 원리:
    1. 모든 에이전트가 SwarmState를 공유하여 문서 컨텍스트와 대화 이력 유지
    2. 에이전트 간 동적 제어 전달 (handoff)로 최적의 전문가가 각 작업 수행
    3. Explainer가 대부분의 쿼리를 먼저 받고, 필요시 다른 에이전트에게 위임

제어 흐름 예시:
    사용자: "이 알고리즘을 Python으로 구현해줘"
    → Explainer가 먼저 받음
    → "코드 예제 필요" 판단
    → transfer_to_developer 도구 호출
    → Developer가 코드 작성
    → 사용자에게 응답 반환
"""

# SWARM을 실행 가능한 LangGraph 애플리케이션으로 컴파일
app = agent_swarm.compile()
"""
app: CompiledStateGraph

컴파일된 실행 가능 LangGraph 애플리케이션으로, SWARM 시스템의 최종 산출물입니다.

주요 메서드:
    - invoke(state): 동기적으로 에이전트 그래프를 실행하고 최종 상태 반환
    - stream(state): 스트리밍 방식으로 에이전트 실행 과정을 반환
    - ainvoke(state): 비동기 버전의 invoke
    - astream(state): 비동기 버전의 stream

사용 예시:
    >>> from langgraph_swarm import SwarmState
    >>> state = SwarmState(messages=[{"role": "user", "content": "설명해줘"}])
    >>> result = app.invoke(state)
    >>> print(result["messages"][-1].content)  # 에이전트 응답 출력

내부 동작:
    1. compile()은 Swarm을 StateGraph로 변환
    2. 각 에이전트를 노드로, handoff 도구를 엣지로 설정
    3. 실행 흐름을 최적화하여 효율적인 에이전트 전환 보장
    4. SwarmState가 그래프 전체에서 일관되게 유지됨

Note:
    - app은 article_explainer_page.py에서 import되어 사용됨
    - Streamlit UI에서 app.invoke()를 호출하여 사용자 쿼리 처리
"""
