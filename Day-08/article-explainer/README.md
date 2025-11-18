# Article Explainer

> AI 에이전트 팀이 함께 협업하여 복잡한 기술 문서를 쉽게 이해할 수 있도록 돕는 지능형 문서 분석 도구

**LangGraph SWARM 아키텍처 기반 Multi-Agent 시스템**

---

## 개요

Article Explainer는 **5개의 전문 AI 에이전트**가 협업하여 PDF 문서를 다양한 관점에서 분석하고 설명하는 시스템입니다. 복잡한 기술 논문, 연구 자료, 법률 문서 등을 빠르게 이해하고 싶을 때 사용하세요.

### 주요 특징

- **Multi-Agent 협업**: 5개의 전문 에이전트가 동적으로 협력
  - **Explainer**: 단계별 상세 설명
  - **Developer**: 코드 예제 및 구현
  - **Summarizer**: 간결한 요약 (TL;DR)
  - **Analogy Creator**: 쉬운 비유로 설명
  - **Vulnerability Expert**: 비판적 분석 및 약점 지적

- **동적 제어 전달**: 각 에이전트가 자율적으로 가장 적합한 전문가에게 작업을 위임
- **상태 공유**: 모든 에이전트가 문서 컨텍스트를 공유하여 일관된 답변 제공
- **역할 기반 분업**: 각 에이전트는 특정 영역에 특화되어 고품질 응답 생성

---

## 빠른 시작

### 사전 요구사항

- Python 3.11 이상
- [uv](https://docs.astral.sh/uv/) 패키지 매니저 (권장)
- OpenAI API 키 (또는 로컬 Ollama 설정)

### 설치

```bash
# 1. 의존성 설치
uv sync

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일을 열어 OPENAI_API_KEY 입력
```

### 환경 변수 (.env 파일)

```bash
# OpenAI API (권장)
OPENAI_API_KEY=sk-proj-your-api-key-here
```

---

## 실행 방법

### 옵션 1: 웹 인터페이스 (로컬 개발)

```bash
uv run streamlit run article_explainer_page.py
```

브라우저에서 `http://localhost:8501` 열기

### 옵션 2: Docker 배포

```bash
# Docker 이미지 빌드
docker build -t article_explainer .

# Docker Compose로 실행
docker compose up -d
```

브라우저에서 `http://localhost:8501` 열기

---

## 사용 방법

### 1단계: PDF 업로드

사이드바에서 PDF 파일을 업로드합니다.
- 지원 형식: `.pdf`
- 자동으로 텍스트를 추출하고 분석 준비

### 2단계: 질문하기

문서에 대해 자유롭게 질문하세요. 에이전트 팀이 자동으로 협력하여 최적의 답변을 제공합니다.

### 일반적인 사용 예시

#### 문서 요약

```
"이 논문을 요약해줘"
"핵심 내용만 알려줘"
"TL;DR"
```
→ **Summarizer** 에이전트가 5-8개 불릿 포인트로 간결하게 정리

#### 상세한 설명

```
"이 알고리즘을 자세히 설명해줘"
"단계별로 알려줘"
"초보자도 이해할 수 있게 설명해줘"
```
→ **Explainer** 에이전트가 단계별로 교육적 설명 제공

#### 코드 예제

```
"이 개념을 Python으로 구현해줘"
"코드 예제 보여줘"
"실제로 어떻게 코딩하나요?"
```
→ **Developer** 에이전트가 동작하는 코드 스니펫 제공

#### 쉬운 비유

```
"초등학생도 이해할 수 있게 설명해줘"
"비유로 설명해줘"
"일상적인 예로 설명하면?"
```
→ **Analogy Creator** 에이전트가 친숙한 비유로 설명

#### 비판적 분석

```
"이 논문의 문제점은?"
"보안 취약점이 있나요?"
"이 주장의 한계는 무엇인가요?"
```
→ **Vulnerability Expert** 에이전트가 약점 및 한계 분석

---

## 아키텍처

### SWARM 패턴

**SWARM** (Specialized Workers with Autonomous Role Management)은 LangGraph의 Multi-Agent 아키텍처 패턴입니다.

```
사용자 쿼리
    ↓
Explainer (기본 에이전트)
    ↓
"코드 예제 필요" 판단
    ↓
Developer로 제어 전달 (Handoff)
    ↓
코드 생성 및 응답
```

**핵심 개념**:
- **Handoff**: 에이전트 간 동적 제어 전달
- **SwarmState**: 모든 에이전트가 공유하는 상태
- **Specialized Agents**: 각자의 전문 영역

---

## 기술 스택

| 카테고리 | 기술 |
|---------|------|
| **프레임워크** | LangChain, LangGraph, LangGraph-Swarm |
| **UI** | Streamlit, streamlit-pdf-viewer |
| **LLM** | OpenAI GPT-4.1-mini (클라우드) |
| **PDF 처리** | PyPDF, RecursiveCharacterTextSplitter |
| **배포** | Docker, Docker Compose |

---

## 프로젝트 구조

```
article-explainer/
├── article_explainer_page.py    # Streamlit UI 메인 파일
├── explainer/
│   ├── graph.py                 # SWARM 시스템 오케스트레이션
│   ├── prompts.py               # 에이전트 시스템 프롬프트
│   └── service/
│       ├── config.py            # LLM 모델 설정
│       └── content_loader.py    # PDF 로더 및 청킹
├── Dockerfile                   # Docker 이미지 정의
└── docker-compose.yml           # 멀티 컨테이너 설정
```

---

## 고급 설정

### 로컬 LLM 사용 (Ollama)

OpenAI API 없이 로컬에서 무료로 실행하고 싶다면:

```bash
# 1. Ollama 설치
# macOS/Linux: https://ollama.ai/download

# 2. 모델 다운로드
ollama pull qwen3:8b

# 3. 서버 시작 (백그라운드)
ollama serve

# 4. Article Explainer 실행 (OPENAI_API_KEY 없이)
uv run streamlit run article_explainer_page.py
```

### 청킹 파라미터 조정

문서 크기에 따라 청킹 설정을 조정할 수 있습니다:

```python
# explainer/service/content_loader.py
loader = ContentLoader(
    chunk_size=500,    # 기본값: 1000
    chunk_overlap=50   # 기본값: 100
)
```

**작은 chunk_size**: 더 정밀한 분할, 더 많은 청크
**큰 chunk_size**: 더 많은 컨텍스트, 더 적은 청크


### 에이전트 응답 느림

- OpenAI API 사용 (빠름)
- 또는 `max_chunks` 감소 (10 → 5)
