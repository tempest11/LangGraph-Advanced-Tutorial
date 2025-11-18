"""
파일명: config.py
설명: LLM 모델 설정 및 초기화 유틸리티

SWARM 패턴에서의 역할:
    - 모든 에이전트가 사용할 LLM 모델 제공
    - OpenAI GPT 또는 로컬 Ollama 모델 선택
    - 환경 변수에서 API 키 로드
"""

import os

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_ollama import ChatOllama


def get_chat_model(model_name: str = "openai:gpt-4.1-mini"):
    """
    LangChain 채팅 모델을 초기화하여 반환하는 함수

    환경 변수에서 OPENAI_API_KEY를 로드하고,
    API 키가 있으면 OpenAI 모델을, 없으면 로컬 Ollama 모델을 반환합니다.

    Args:
        model_name (str, optional): 사용할 모델 이름. 기본값 "openai:gpt-4.1-mini"
                                   "provider:model" 형식으로 지정
                                   예: "openai:gpt-4", "anthropic:claude-3"

    Returns:
        ChatOpenAI | ChatOllama: 초기화된 LangChain 채팅 모델
                                - OPENAI_API_KEY가 있으면: OpenAI 모델 (ChatOpenAI)
                                - OPENAI_API_KEY가 없으면: 로컬 Ollama 모델 (ChatOllama, qwen3:8b)

    Raises:
        ConnectionError: Ollama 서버에 연결할 수 없을 때 (API 키 없을 시)
                        - Ollama가 설치되지 않았거나 실행 중이 아닐 때 발생
                        - 해결: `ollama serve` 명령으로 Ollama 서버 시작
        ValueError: 잘못된 model_name 형식일 때 ("provider:model" 형식 필수)

    Example:
        >>> # OpenAI 모델 사용 (.env에 OPENAI_API_KEY 설정)
        >>> model = get_chat_model("openai:gpt-4")
        >>> response = model.invoke("Hello!")

        >>> # Ollama 로컬 모델 사용 (API 키 없을 때 자동 fallback)
        >>> model = get_chat_model()  # OPENAI_API_KEY 없으면 qwen3:8b 사용
        >>> response = model.invoke("안녕하세요!")

    Note:
        - .env 파일에 OPENAI_API_KEY를 설정하여 사용
        - Ollama는 로컬에서 모델을 호스팅할 때 사용 (http://localhost:11434)
        - SWARM의 모든 에이전트가 이 함수로 초기화된 동일한 모델을 사용
        - Fallback 메커니즘: OpenAI API → Ollama 로컬 모델

    Ollama 설정 가이드:
        1. Ollama 설치: https://ollama.ai/download
        2. 모델 다운로드: `ollama pull qwen3:8b`
        3. 서버 시작: `ollama serve` (백그라운드에서 자동 실행)
        4. 테스트: `ollama run qwen3:8b "Hello"`
    """
    # .env 파일에서 환경 변수 로드
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        # API 키가 없는 경우: 로컬 Ollama 모델 사용
        # Ollama는 로컬 컴퓨터에서 LLM을 실행할 수 있게 해주는 도구
        # qwen3:8b는 80억 파라미터의 Qwen3 모델
        return ChatOllama(
            model="qwen3:8b",  # 사용할 Ollama 모델
            base_url="http://localhost:11434",  # Ollama 서버 주소
        )

    # API 키가 있는 경우: OpenAI 모델 사용
    # init_chat_model은 LangChain의 통합 모델 초기화 함수
    return init_chat_model(model=model_name, api_key=api_key)
