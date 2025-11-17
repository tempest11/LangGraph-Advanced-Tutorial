# **vLLM v0.11.0 분석: 아키텍처, 온프레미스 Docker 배포 및 활용**

## **vLLM의 시스템적 접근**

vLLM은 UC Berkeley Sky Computing Lab에서 시작된 고성능 대규모 언어 모델(LLM) 추론 및 서빙 엔진입니다. vLLM은 단순한 추론 스크립트가 아니라, LLM 서빙 환경의 근본적인 병목 현상을 해결하기 위해 설계된 정교한 시스템입니다. 그 핵심 혁신은 어텐션 메커니즘의 Key-Value (KV) 캐시 관리를 최적화하는 **PagedAttention** 1과, 이를 통해 GPU 활용률을 극대화하는 **연속적 배치 처리(Continuous Batching)**에 있습니다.

vLLM의 **v0.11.0** 릴리스 버전을 기준으로, 모든 배포 및 활용 사례를 **온프레미스 Docker** 환경으로 엄격히 제한하여 분석합니다. 
**v0.11.0 버전은 레거시 V0 엔진이 완전히 제거되고 V1 아키텍처로 통합된 중대한 릴리스로, KV 캐시 CPU 오프로딩과 같은 새로운 V1 네이티브 기능이 도입된 시점**입니다.

## **vLLM의 핵심 이론적 혁신: PagedAttention과 연속적 배치 처리**

### **기존 시스템의 문제점: 심각한 메모리 낭비**

LLM 추론의 성능은 주로 어텐션 메커니즘을 위해 GPU 메모리에 저장되는 Key-Value (KV) 캐시에 의해 제한됩니다. 기존의 서빙 시스템(예: FasterTransformer)은 각 요청(시퀀스)이 생성할 수 있는 최대 토큰 길이를 미리 예측하고, 이 길이에 맞춰 *연속적인(contiguous)* 메모리 청크를 사전 할당합니다.

이 방식은 심각한 메모리 비효율성을 초래하며, vLLM 팀의 분석에 따르면 기존 시스템에서 GPU 메모리의 **60%에서 80%가 낭비**됩니다. 이 낭비는 두 가지 형태로 발생합니다:

1. **내부 단편화 (Internal Fragmentation):** 대부분의 요청은 설정된 최대 길이에 도달하기 전에 생성을 완료합니다. 예를 들어, 2048 토큰을 예약했지만 100 토큰만 생성한 경우, 나머지 1948 토큰 분량의 메모리는 낭비됩니다.
2. **외부 단편화 (External Fragmentation):** 다양한 길이의 요청들이 **메모리를 할당받고 해제하는 과정에서, 총 가용 메모리는 충분하더라도 큰 연속 블록을 찾지 못해 새로운 요청을 처리하지 못하는 파편화가 발생**합니다.

### **PagedAttention의 작동 원리: OS 가상 메모리의 적용**

PagedAttention은 이러한 메모리 낭비 문제를 해결하기 위해 운영체제(OS)의 고전적인 **가상 메모리(Virtual Memory)** 및 **페이징(Paging)** 개념을 LLM KV 캐시 관리에 도입했습니다.

* **핵심 아이디어:** KV 캐시를 물리적으로 연속적인 큰 덩어리로 할당하는 대신, **물리적으로 비연속적인(non-contiguous)** 고정된 크기의 '블록(block)'에 분산하여 저장합니다.
* **블록 테이블 (Block Table):** OS가 프로세스별로 '페이지 테이블'을 유지 관리하듯, vLLM은 각 시퀀스(요청)별로 '블록 테이블'을 유지합니다. 이 테이블은 시퀀스의 *논리적* 토큰 인덱스를 실제 GPU 메모리의 *물리적* 블록 주소로 매핑(mapping)하는 역할을 합니다.
* **동적 할당 (On-demand Allocation):** vLLM은 토큰이 생성될 때마다 **필요에 따라(on-demand)** 새로운 물리 블록을 할당하고 블록 테이블을 업데이트합니다.
이 접근 방식 덕분에 메모리 낭비는 각 시퀀스의 *마지막 블록*에서만 발생하며, vLLM은 이 낭비율을 **평균 4% 미만**으로 극적으로 감소시켰습니다.

### **PagedAttention이 실현하는 '연속적 배치 처리 (Continuous Batching)'**

PagedAttention의 유연하고 효율적인 메모리 관리는 vLLM의 또 다른 핵심 기능인 '연속적 배치 처리'를 가능하게 합니다.

* **정적 배치 (Static Batching)의 한계:** 기존 시스템은 여러 요청을 하나의 배치로 묶어 처리합니다. 이 방식의 치명적인 단점은 배치 내에서 *가장 긴* 시퀀스가 생성을 완료할 때까지, 이미 생성을 완료한 다른 모든 시퀀스들이 기다려야 한다는 것입니다. 이 시간 동안 GPU는 유휴 상태(idle)가 됩니다.
* **연속적 배치 (vLLM 방식):** vLLM은 반복(iteration) 수준에서 스케줄링을 수행합니다. 즉, 배치 내의 특정 요청이 생성을 완료(예: EOS 토큰 생성)하는 즉시, vLLM은 해당 요청을 배치에서 제거하고 그 자원에 새로운 요청을 즉시 스케줄링하여 삽입합니다.
* 이는 GPU가 유휴 상태 없이 거의 100%에 가까운 작업률을 유지하도록 보장하며, vLLM이 기존 시스템 대비 최대 23배 더 높은 처리량(throughput)을 달성하는 핵심 비결입니다.

### **부수적 이점: 효율적인 메모리 공유 (Efficient Memory Sharing)**

PagedAttention의 블록 기반 아키텍처는 메모리 공유를 매우 효율적으로 만듭니다. 예를 들어, 병렬 샘플링(best_of > 1)이나 빔 서치(Beam Search)를 수행할 때, 여러 개의 후보 시퀀스가 동일한 프롬프트를 공유합니다.

기존 시스템은 이 공통 프롬프트의 KV 캐시를 모든 후보 시퀀스마다 복사해야 했습니다. 반면, vLLM은 단순히 여러 시퀀스의 블록 테이블이 동일한 *물리적* 메모리 블록을 가리키도록(참조 카운팅) 합니다. 이후 새로운 토큰이 생성될 때만 'Copy-on-Write' 방식으로 새 블록을 할당합니다. 이로 인해 복잡한 샘플링 알고리즘의 메모리 오버헤드가 획기적으로 감소합니다.

### **시스템 트레이드오프 분석**

PagedAttention은 시스템 아키텍처의 고전적인 트레이드오프를 보여줍니다. 최근 연구12에 따르면, PagedAttention 커널 자체는 블록 테이블 조회(lookup overhead) 및 추가적인 분기(extra branches)로 인해, PagedAttention을 사용하지 않는 고도로 융합된(fused) FasterTransformer 커널보다 마이크로 벤치마크 상에서 약 20-26% 느릴 수 있습니다.

이는 모든 가상화(virtualization) 계층이 '주소 변환' 오버헤드를 갖는 것과 동일한 원리입니다. 하지만 vLLM은 이 미미한 커널 수준의 속도 저하를 감수하는 대신, 메모리 단편화를 96%까지 줄여 GPU 유휴 시간을 제거하고 시스템 전체의 배치 효율성을 극대화하는 매크로 최적화를 선택했습니다.

결론적으로, vLLM의 혁신은 '더 빠른 어텐션 연산'이 아니라 '더 효율적인 메모리 관리 시스템'입니다. 이 시스템은 약간의 연산 오버헤드를 대가로 메모리 파편화를 사실상 제거함으로써, GPU 활용률을 극한으로 끌어올려 전례 없는 시스템 처리량(최대 23배)을 달성합니다.

## **vLLM v0.11.0: V1 엔진 및 주요 변경 사항**

### **V1 엔진으로의 완전한 전환**

v0.11.0 릴리스의 가장 중대한 변경 사항은 **V0 엔진의 완전한 제거**입니다.

* AsyncLLMEngine, LLMEngine, MQLLMEngine 등 V0 엔진과 관련된 모든 레거시 코드, 어텐션 백엔드 및 관련 구성 요소가 코드베이스에서 완전히 삭제되었습니다.
* 이제 **V1 엔진이 vLLM의 유일한(only) 엔진**입니다.
* 이는 v0.11.0 사용자가 V0 엔진(예: VLLM_USE_V1=0)을 참조하는 이전 버전의 문서나 가이드를 따를 경우, 심각한 호환성 오류에 직면하게 됨을 의미합니다. 
    v0.11.0의 모든 배포는 V1 아키텍처를 전제로 해야 합니다.

### **CUDA 그래프 모드 기본값 변경**

v0.11.0은 CUDA 그래프(CUDA Graph) 모드의 기본값을 FULL_AND_PIECEWISE로 변경했습니다. 이는 MoE(Mixture of Experts) 모델과 같이 세분화된(fine-grained) 커널이 많은 최신 모델 아키텍처에 대해 별도의 설정 없이도 더 나은 기본 성능(out-of-the-box performance)을 제공하기 위한 조치입니다. 동시에 기존 PIECEWISE 모드만 지원하던 모델과의 호환성도 유지합니다.

### **v0.11.0 엔진 코어의 주요 신기능**

V1 엔진이 유일한 아키텍처가 됨에 따라, v0.11.0은 V1 엔진을 위한 새로운 고급 기능을 도입했습니다.

* **KV 캐시 CPU 오프로딩:** v0.11.0 릴리스 노트는 **LRU(Least Recently Used) 관리 기능이 포함된 CPU 오프로딩** 기능이 V1 엔진 코어에 공식적으로 추가되었음을 명시합니다.
이는 GPU 메모리 한계를 넘어 더 큰 컨텍스트나 더 많은 배치를 처리할 수 있게 하는 중요한 기능입니다.
* **V1 기능 확장:** 이 외에도 프롬프트 임베딩(Prompt Embeddings) 지원 및 샤딩된 모델 상태 로딩(Sharded State Loading) 등 V1 엔진의 기능성이 대폭 강화되었습니다.

### **v0.11.0 배포 시 치명적인 주의사항**

v0.11.0 릴리스 노트는 온프레미스 배포 시 반드시 인지해야 할 치명적인 버그를 명시하고 있습니다.

* **데이터:** v0.11.0 (및 v0.10.2) 버전에서 **--async-scheduling 인수를 활성화**할 경우, 선점(preemption)이나 특정 스케줄링 시나리오에서 **"gibberish output" (의미 없는 손상된 텍스트)**이 출력될 수 있습니다.
* **분석:** async-scheduling은 vLLM V1 엔진에서 응답 지연 시간을 줄이기 위한 핵심 기능 중 하나입니다. v0.11.0의 최신 기능을 활용하려는 관리자가 이 인수를 활성화하는 것은 자연스러운 선택이지만, 이 버전에 한해 해당 기능에 치명적인 버그가 존재하여 모델 출력을 신뢰할 수 없게 만듭니다.
* **결론:** v0.11.0 버전을 온프레미스 Docker 환경에 배포할 경우, **안정적인 서비스를 위해 --async-scheduling 인수를 절대로 사용해서는 안 됩니다.** 이 기능은 v0.10.1에서는 정상 작동했으며 v0.11.0 이후 릴리스에서 수정될 예정입니다. 따라서 v0.11.0을 고수해야 하는 환경에서는 이 기능의 비활성화를 감수해야 하는 명확한 트레이드오프가 존재합니다.

## **온프레미스 Docker 기반 OpenAI Compatible API 서버 구축**

### **vllm/vllm-openai:v0.11.0 이미지 배포**

vLLM은 OpenAI 호환 서버 기능이 사전 빌드된 공식 Docker 이미지를 Docker Hub를 통해 vllm/vllm-openai라는 이름으로 제공합니다. 본 가이드는 vllm/vllm-openai:v0.11.0 사용을 전제로 합니다.

### **온프레미스 docker run 전체 명령어 및 인수 해설**

다음은 v0.11.0 API 서버 구동을 위한 표준 온프레미스 docker run 명령어입니다.

```bash
docker run --runtime nvidia --gpus all
    -v ~/.cache/huggingface:/root/.cache/huggingface
    --env "HUGGING_FACE_HUB_TOKEN=$HF_TOKEN"
    -p 8000:8000
    --ipc=host
    vllm/vllm-openai:v0.11.0
    --model openai/gpt-oss-20b
    --gpu-memory-utilization 0.9
```

#### **핵심 Docker 인수 해설**

* --runtime nvidia --gpus all: 컨테이너가 호스트 시스템의 모든 NVIDIA GPU에 접근할 수 있도록 NVIDIA 컨테이너 런타임을 사용합니다.
* -v ~/.cache/huggingface:/root/.cache/huggingface: 호스트의 Hugging Face 캐시 디렉터리를 컨테이너 내부의 /root/.cache/huggingface로 마운트합니다. 이는 온프레미스 환경에서 컨테이너를 재시작할 때마다 수십 GB의 모델 가중치를 반복해서 다운로드하는 것을 방지하는 **필수 설정**입니다.
* --ipc=host: 컨테이너가 호스트 시스템의 IPC(Inter-Process Communication) 네임스페이스를 공유하도록 설정합니다. vLLM은 PyTorch를 기반으로 하며, 특히 텐서 병렬 처리(Tensor Parallelism) 프로세스 간(즉, 여러 GPU 워커 간) 데이터 통신을 위해 호스트의 공유 메모리(shm)를 사용해야 합니다.

이 --ipc=host 플래그(또는 대안으로 --shm-size=16G와 같이 충분한 공유 메모리를 명시적으로 할당)의 누락은, vLLM이 단일 GPU를 넘어 다중 GPU로 확장될 때 발생하는 가장 흔한 온프레미스 배포 실패 지점입니다.

#### **vLLM 엔진 인수**

vllm/vllm-openai:v0.11.0 **이미지 태그 뒤에 오는 모든 인수는 vLLM 엔진으로 직접 전달**됩니다.

* --model openai/gpt-oss-20b: 로드할 Hugging Face 모델을 지정합니다.
* --gpu-memory-utilization 0.9: 핵심 튜닝 파라미터로, KV 캐시에 할당할 GPU 메모리 비율을 설정합니다.

### **API 엔드포인트 활용 (Python 및 curl)**

서버가 http://localhost:8000에서 정상적으로 실행 중이라고 가정합니다.

#### **Chat Completions API (/v1/chat/completions)**

* Python (OpenAI 클라이언트 사용):
```python
  from openai import OpenAI

  client = OpenAI(
      base_url="http://localhost:8000/v1",
      api_key="token-abc123"
  )

  completion = client.chat.completions.create(
    model="mistralai/Mistral-7B-Instruct-v0.1", # 채팅 템플릿이 있는 모델 권장
    messages=
  )
  print(completion.choices.message.content)
```

* **curl 예제:**
```bash
  curl http://localhost:8000/v1/chat/completions
  -H "Authorization: Bearer token-abc123"
  -H "Content-Type: application/json"
  -d '{
      "model": "mistralai/Mistral-7B-Instruct-v0.1",
      "messages":
  }'
```

#### **고급 API 기능: logprobs 및 '도구 호출(Tool Calling)'**

v0.11.0은 단순 텍스트 생성을 넘어선 고급 API 기능들을 지원합니다.

* **Logprobs:** v0.11.0은 프롬프트 토큰에 대한 로그 확률(log probability) 반환을 지원합니다. API 요청 시 logprobs=True 및 (필요시) top_logprobs=N을 포함하여 토큰 확률 정보를 얻을 수 있습니다.
* **도구 호출 (Tool Calling):** v0.11.0은 OpenAI 호환 도구 호출 기능을 지원합니다. 이를 사용하려면 서버 시작 시 모델에 맞는 특정 인수가 필요할 수 있으며(예: --enable-auto-tool-choice), 클라이언트는 OpenAI와 동일한 tools 및 tool_choice JSON 스키마를 메시지에 포함하여 전송합니다.

## **오프라인 배치 추론 및 복잡한 샘플링**

API 서버를 통한 '온라인 서빙'과 달리, 대규모 데이터셋에 대한 일괄 변환이나 연구 목적으로 '오프라인 추론'이 필요할 수 있습니다. 이 경우, AsyncLLMEngine 대신 vLLM의 핵심 LLM 클래스를 직접 사용하는 것이 훨씬 효율적입니다.

### **온라인 서빙 (AsyncLLMEngine) vs. 오프라인 추론 (LLM)**

* **온라인 서빙 (API 서버):** 요청이 지속적으로 유입되며, 개별 요청의 첫 응답 시간(TTFT)과 같은 낮은 지연 시간(low latency)이 중요합니다.
* **오프라인 추론 (LLM 클래스):** 모든 프롬프트가 미리 알려진 상태에서 실행됩니다. 전체 작업 완료 시간(total throughput)이 중요합니다.

### **LLM 및 SamplingParams를 사용한 Python 스크립트**

vLLM의 오프라인 추론은 vllm.LLM (엔진 및 모델 로더)과 vllm.SamplingParams (생성 방식 정의) 두 클래스를 중심으로 이루어집니다.

이 스크립트는 Docker 컨테이너 *내에서* 실행하거나, 호스트에 vLLM 라이브러리가 설치된 경우 직접 실행할 수 있습니다. Docker 컨테이너 내에서 사용자 정의 스크립트(예: my_offline_script.py)를 실행하는 명령어는 다음과 같습니다.

```bash
docker run --runtime nvidia --gpus all --ipc=host
    -v $(pwd):/app
    -v ~/.cache/huggingface:/root/.cache/huggingface
    vllm/vllm-openai:v0.11.0
    python /app/my_offline_script.py
```

### **SamplingParams를 활용한 복잡한 샘플링 전략**

SamplingParams 객체는 OpenAI API보다 훨씬 더 세분화되고 복잡한 생성 제어 기능을 제공합니다.

1. **Top-p/Top-k 샘플링 (확률적 샘플링):**
   * temperature > 0, top_p < 1.0, top_k > 0 (또는 -1로 비활성화) 조합을 사용합니다.
   * 예: SamplingParams(temperature=0.7, top_p=0.9, top_k=50, max_tokens=100)
2. **빔 서치 (Beam Search):**
   * vLLM은 best_of 파라미터를 빔의 폭(beam width)으로 사용하여 빔 서치를 지원합니다.(구 버전에서는 use_beam_search=True 플래그 사용).
   * best_of는 반환할 시퀀스 수 n보다 크거나 같아야 합니다. 빔 서치 시 보통 temperature=0.0을 사용합니다.
   * 예: SamplingParams(best_of=4, n=2, temperature=0.0, max_tokens=100)
   * 참고: v0.11.0에서는 BeamSearchParams라는 별도 객체를 사용할 수도 있습니다.
3. **스톱 시퀀스 (Stop Sequences):**
   * stop (문자열 리스트) 또는 stop_token_ids (토큰 ID 리스트)를 제공하여 특정 지점에서 생성을 강제로 중단시킬 수 있습니다.
   * 예: SamplingParams(stop=["n", "###"], max_tokens=100)

### **Python 코드 예제 (v0.11.0 기준)**

다음은 위 전략들을 결합한 오프라인 추론 Python 스크립트 예제입니다.

```python
from vllm import LLM, SamplingParams

# 1. LLM 엔진 초기화 (모델 로드)
# v0.11.0에서는 V1 엔진만 사용됩니다
llm = LLM(model="openai/gpt-oss-20b")

# 2. 처리할 프롬프트 리스트
prompts =

# 3. 다양한 샘플링 전략 정의

# 전략 1: Top-p 샘플링 및 스톱 시퀀스
sampling_top_p = SamplingParams(
    temperature=0.7,
    top_p=0.95,
    top_k=50,
    max_tokens=100,
    stop=["."] # 마침표에서 중단 [24]
)

# 전략 2: 빔 서치 (best_of 활용)
# [25, 28] 참고
sampling_beam = SamplingParams(
    best_of=4,       # 빔 서치 폭 (beam width)
    n=1,             # 최상의 1개 시퀀스 반환
    temperature=0.0, # 빔 서치는 보통 결정론적으로(greedy) 수행
    max_tokens=100,
    early_stopping=True #
)

# 전략 3: 병렬 샘플링 (best_of와 n 활용)
# best_of=3, n=3 -> 3개의 독립적인 샘플링 수행
sampling_parallel = SamplingParams(
    best_of=3,
    n=3,
    temperature=0.8,
    top_k=50,
    max_tokens=100
)

# 4. 배치 추론 실행
print("---  Top-p Sampling (stop='.') ---")
outputs_top_p = llm.generate(prompts, sampling_top_p)
for output in outputs_top_p:
    print(f"Prompt: {output.prompt!r}")
    print(f"Generated: {output.outputs.text!r}n")

print("---  Beam Search (best_of=4) ---")
outputs_beam = llm.generate(prompts, sampling_beam)
for output in outputs_beam:
    print(f"Prompt: {output.prompt!r}")
    print(f"Generated: {output.outputs.text!r}n")

print("---  Parallel Sampling (n=3) ---")
outputs_parallel = llm.generate(prompts, sampling_parallel)
for output in outputs_parallel:
    print(f"Prompt: {output.prompt!r}")
    # n=3이므로 3개의 출력이 반환됨
    for i, generated_seq in enumerate(output.outputs):
        print(f"  Sample {i+1}: {generated_seq.text!r}")
    print("")
```

### **표 1: 주요 SamplingParams 전략 비교**

다음 표는 특정 사용 사례에 맞는 SamplingParams 조합을 요약한 것입니다.

| 전략 | 주요 파라미터 조합 | temperature | 권장 사용 사례 |
| :---- | :---- | :---- | :---- |
| **Greedy (결정론적)** | best_of=1, n=1 | 0.0 | 결정론적 출력. (요약, 분류, 번역) |
| **Top-p/Top-k 샘플링** | best_of=1, n=1, top_p < 1.0, top_k > 0 | > 0 (예: 0.7) | 창의적이고 다양한 단일 출력. (창의적 글쓰기, 챗봇) |
| **빔 서치 (Beam Search)** | best_of > 1 (예: 4), n=1, use_beam_search=True (구) | 0.0 | 고품질, 논리적으로 일관성 있는 단일 출력. (기계 번역, 긴 텍스트 요약) |
| **병렬 샘플링** | best_of = N, n = N (예: best_of=3, n=3) | > 0 (예: 0.7) | 여러 개의 다양한 후보군 생성 후 최고 품질 선택. (RAG 후처리, 콘텐츠 생성) |

참고: best_of > 1 파라미터는 temperature=0.0과 결합하면 빔 서치로 작동하고, temperature > 0과 결합하면 병렬 샘플링으로 작동하여, 동일한 파라미터가 완전히 다른 두 가지 목적25으로 사용됨을 유의해야 합니다.

## **다중 GPU 배포 및 분산 추론 (텐서 병렬 처리)**

모델의 크기가 단일 GPU의 메모리 한계를 초과하거나(예: 70B 모델), 더 높은 처리량을 위해 여러 GPU의 연산 능력을 동시에 활용해야 할 때 vLLM의 분산 추론 기능이 필요합니다.

### **분산 추론의 유형**

vLLM은 다양한 분산 전략을 지원합니다:

1. **텐서 병렬 처리 (Tensor Parallelism, TP):** 각 모델 레이어(즉, 가중치 행렬)를 여러 GPU에 걸쳐 샤딩(분할)합니다. 이는 일반적으로 단일 노드 내의 다중 GPU 간 통신(예: NVLink)에 최적화되어 있습니다.
2. **파이프라인 병렬 처리 (Pipeline Parallelism, PP):** 모델의 레이어 자체를 여러 노드(또는 GPU)에 파이프라인 형태로 분산시킵니다 (예: 0-20 레이어는 노드 1, 21-40 레이어는 노드 2).
3. **데이터 병렬 처리 (Data Parallelism, DP):** 동일한 모델을 여러 GPU에 복제하고, 입력 데이터 배치를 분할하여 병렬로 처리합니다.

온프레미스 Docker 환경에서 가장 일반적인 고급 사용 사례는 **단일 노드 내 다중 GPU를 활용하는 텐서 병렬 처리(TP)**입니다.

### **온프레미스 Docker와 텐서 병렬(TP) 구성**

* **사용 사례:** 단일 온프레미스 서버에 4개의 A100 GPU가 있고, 70B 모델(단일 A100 80GB에 적재 불가)을 서빙하려는 경우.
* **핵심 인수:** --tensor-parallel-size N. 여기서 N은 모델을 분할할 GPU의 총 수입니다.
* **Docker 명령어 수정:**
  * docker run 명령어에 --tensor-parallel-size 4를 vLLM 엔진 인수로 추가합니다.
  * **필수 요구사항:** [IV 섹션]에서 강조했듯이, 텐서 병렬 처리는 GPU 워커 간의 고속 통신을 위해 PyTorch의 공유 메모리를 광범위하게 사용합니다. 따라서 docker run 명령어에 --ipc=host (또는 --shm-size=16G 등)가 **반드시 포함**되어야 합니다.

다음은 4개 GPU를 사용하는 단일 노드에서 텐서 병렬 처리를 구성하는 전체 docker run 명령어 예제입니다.

# 4개의 GPU를 사용하는 단일 노드에서 TP=4로 70B 모델 실행
```bash
docker run --runtime nvidia --gpus all
    -v ~/.cache/huggingface:/root/.cache/huggingface
    --env "HUGGING_FACE_HUB_TOKEN=$HF_TOKEN"
    -p 8000:8000
    --ipc=host
    --shm-size=16G
    vllm/vllm-openai:v0.11.0
    --model "openai/gpt-oss-120b"
    --tensor-parallel-size 4
    --gpu-memory-utilization 0.9
```
* **작동 방식:** 이 명령으로 vLLM이 시작되면, 엔진은 Llama-2-70b-hf 모델의 가중치를 4개의 GPU에 걸쳐 자동으로 분할하여 로드합니다.33 PagedAttention KV 캐시 또한 4개의 GPU 메모리에 분산되어 저장됩니다.

### **다중 노드(PP + TP) 구성 (참고)**

모델이 단일 노드(예: 8개 GPU)의 총 메모리에도 맞지 않는 경우, 텐서 병렬(TP)과 파이프라인 병렬(PP)을 결합해야 합니다.

* **예:** 2개의 노드, 각 노드당 8개의 GPU (총 16 GPU)
* **인수:** --tensor-parallel-size 8 (노드당 GPU 수) 및 --pipeline-parallel-size 2 (총 노드 수).
* 이는 단순 docker run을 넘어 Kubernetes, Docker Swarm 또는 Ray 클러스터와 같은 고급 컨테이너 오케스트레이션이 필요한 최상위 온프레미스 설정입니다. vLLM은 Ray를 사용한 분산 추론을 공식적으로 지원합니다.

## **다중 LoRA(Multi-LoRA) 어댑터 서빙**

다중 LoRA(Multi-LoRA) 서빙은 단일 기본 모델(Base Model) 가중치를 GPU 메모리에 한 번만 로드한 상태에서, 수백 또는 수천 개의 서로 다른 경량 LoRA(Low-Rank Adaptation) 어댑터를 동시에 서빙하는 기능입니다. 이는 비용 효율적인 다중 테넌트(multi-tenant) 서비스나 동적 어댑터 스위칭에 필수적입니다.

vLLM은 Punica CUDA 커널 41과 유사한 기술을 통합하여, 요청별로 LoRA 가중치를 동적으로 융합(fuse)하는 작업을 매우 효율적으로 처리합니다.

### **vLLM Docker 서버 LoRA 활성화 (필수 시작 인수)**

Multi-LoRA 기능을 사용하기 위해 docker run 명령어의 vLLM 엔진 인수에 다음 플래그들을 추가해야 합니다.

1. --enable-lora: Multi-LoRA 서빙 기능을 활성화합니다.
2. --max-lora-rank N: vLLM이 서빙할 LoRA 어댑터들의 *최대 랭크(rank)*를 지정합니다.
3. --max-loras N: 동시에 GPU 메모리에 로드할 수 있는 *최대 LoRA 어댑터 수*를 지정합니다.

### **Multi-LoRA의 메모리 트레이드오프 분석**

--enable-lora를 활성화하는 것은 단순한 기능 추가가 아니며, 메모리 아키텍처에 중대한 트레이드오프를 발생시킵니다.

* --max-lora-rank 및 --max-loras 인수는 vLLM 엔진이 시작 시 LoRA 가중치를 위한 **전용 메모리 풀을 사전 할당(pre-allocate)** 하도록 강제합니다.
* 이 사전 할당된 메모리 풀은 LoRA 전용으로 예약되며, PagedAttention KV 캐시 풀(즉, 동시 요청 처리 용량)이 사용할 수 *없는* 공간이 됩니다.
* 예를 들어, 실제 사용할 LoRA들의 최대 랭크가 64임에도 불구하고, --max-lora-rank=256과 같이 불필요하게 높은 값을 설정하면, 해당 메모리는 사용되지 않으면서 낭비됩니다.
* 결론적으로, Multi-LoRA 활성화는 **(유연성 및 다중 테넌시)**를 얻는 대신, 동일한 하드웨어에서 **(최대 동시 요청 처리량)**을 일부 희생하는 명확한 트레이드오프 관계에 있습니다. 온프레미스 관리자는 서빙할 LoRA의 최대 랭크와 개수를 정확히 파악하여, 이 인수들을 가능한 한 보수적으로(타이트하게) 튜닝해야 메모리 낭비를 최소화할 수 있습니다.

### **LoRA 어댑터 서빙 방법 3가지**

LoRA가 활성화된 서버에서 어댑터를 사용하는 방법은 다음과 같습니다.

#### **1. 정적 로드 (서버 시작 시)**

--lora-modules 인수를 사용하여 서버 시작 시 명명된 LoRA 어댑터들을 미리 로드할 수 있습니다.

```bash
docker run --runtime nvidia --gpus all --ipc=host
    -v /path/to/loras:/loras
    vllm/vllm-openai:v0.11.0
    --model "meta-llama/Llama-2-7b-hf"
    --enable-lora
    --max-lora-rank 16
    --max-loras 10
    --lora-modules sql-adapter=/loras/sql,summary-adapter=/loras/summary
```

#### **2. 동적 로드 (OpenAI API 요청 시)**

OpenAI 호환 API 요청 시 model 필드에 <base_model_id>:<lora_name> 형식을 사용하여 특정 LoRA 어댑터를 동적으로 지정할 수 있습니다.

```bash
curl http://localhost:8000/v1/chat/completions
-H "Authorization: Bearer token-abc123"
-H "Content-Type: application/json"
-d '{
    "model": "meta-llama/Llama-2-7b-hf:sql-adapter",
    "messages": [
        {"role": "user", "content": "Query the user table..."}
    ]
}'
```

참고: v0.11.0에서는 VLLM_ALLOW_RUNTIME_LORA_UPDATING=True 환경 변수를 설정하여, 서버 실행 중에 새로운 LoRA를 로드/언로드하는 API 엔드포인트(/v1/load_lora_adapter)를 활성화할 수 있습니다. 단, vLLM 문서는 이 기능이 프로유션 환경에서 "위험(risky)"할 수 있다고 경고합니다.

#### **3. 오프라인 추론 (LoRARequest 객체)**

오프라인 추론(LLM 클래스) 사용 시, generate() 메소드에 lora_request 매개변수를 전달하여 LoRA를 적용합니다.

```python
from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest # [50]

# LoRA를 활성화하여 LLM 엔진 초기화
llm = LLM(
    model="meta-llama/Llama-2-7b-hf",
    enable_lora=True,
    max_lora_rank=16
)

prompts = ["[user] Write a SQL query... [/user][assistant]"]
sampling_params = SamplingParams(temperature=0, max_tokens=100)

# 사용할 LoRA 어댑터 정의
lora_path = "/path/to/sql-lora"
lora_req = LoRARequest(
    lora_name="sql_adapter",
    lora_int_id=1,
    lora_local_path=lora_path
) # [50]

# generate 호출 시 lora_request 전달
outputs = llm.generate(
    prompts,
    sampling_params,
    lora_request=lora_req
) # [44]

print(outputs.outputs.text)
```
## **v0.11.0 성능 튜닝 및 메모리 최적화**

vLLM 서버의 성능(처리량 및 지연 시간)은 몇 가지 핵심 엔진 인수에 의해 크게 좌우됩니다. 온프레미스 환경에서는 하드웨어를 완벽하게 제어할 수 있으므로, 이 파라미터들을 튜닝하는 것이 매우 중요합니다.

### **표 2: vLLM 성능 튜닝 핵심 인수**

다음 표는 v0.11.0의 주요 성능 관련 인수의 영향과 트레이드오프를 요약한 것입니다.

| 파라미터 | 기본값 (근사) | 인과 관계 (Causal Relationship) | 권장 튜닝 전략 |
| :---- | :---- | :---- | :---- |
| **gpu_memory_utilization** | 0.9 | **(증가 시)** PagedAttention KV 캐시 풀 증가 ➡️ 더 많은 동시 요청 또는 더 긴 컨텍스트 처리 가능 ➡️ **처리량(Throughput) 증가**. **(단점)** 모델 가중치 로드 실패 또는 OOM(Out-of-Memory) 발생 위험 증가. | OOM이 발생하지 않는 한도 내에서 최대한 높게 설정 (예: 0.95). 사용 가능한 총 메모리에서 모델 가중치 크기를 뺀 값이 KV 캐시 풀의 크기가 됩니다. |
| **max_model_len** | (모델 config.json) | **(증가 시)** 더 긴 프롬프트 및 생성 지원. **(단점)** 단일 시퀀스가 점유할 수 있는 최대 KV 블록 수 증가 ➡️ 총 동시 시퀀스 수 감소 ➡️ **처리량(Throughput) 감소**. | 서비스가 지원해야 하는 *절대 최대* 시퀀스 길이로 설정합니다. 불필요하게 늘릴 경우(예: 32k), 짧은 요청들의 처리량이 급격히 감소합니다. |
| **max_num_batched_tokens** | (버전마다 다름, 예: 512 54) | **(증가 시)** 단일 배치에 더 많은 *프리필(prefill)* 토큰 포함 가능 ➡️ 긴 프롬프트 처리 효율 증가 ➡️ **첫 토큰 지연 시간(TTFT) 개선**. **(단점)** 디코딩(decode) 스텝이 지연될 수 있어, **초당 토큰 처리량(ITL)은 감소**할 수 있음. | TTFT(긴 프롬프트)가 중요하다면 값을 늘리고 (예: max_model_len 값 근처 54), ITL(짧은 프롬프트/긴 생성)이 중요하다면 기본값 근처에서 튜닝합니다. |
| **tensor_parallel_size** | 1 | **(증가 시)** 모델 가중치와 KV 캐시가 N개 GPU로 분산 ➡️ 단일 GPU의 메모리 부담 감소 ➡️ 더 큰 모델 로드 가능 / gpu_memory_utilization 상향 가능. | [VI 섹션] 참조. 모델이 단일 GPU에 맞지 않을 때 GPU 수만큼 설정합니다. |

이 파라미터들은 상호 의존적입니다. 예를 들어, max_model_len을 늘리면, 동일한 gpu_memory_utilization 하에서 처리 가능한 동시 요청 수가 줄어듭니다.

### **v0.11.0 신규 기능: KV 캐시 오프로딩 (CPU Offloading)**

v0.11.0 릴리스는 V1 엔진 코어에 **KV 캐시 CPU 오프로딩** 기능을 공식적으로 도입했습니다. 이는 GPU 메모리가 PagedAttention 블록으로 가득 찼을 때, LRU(Least Recently Used) 정책에 따라 가장 오랫동안 사용되지 않은 블록을 GPU 메모리에서 CPU RAM으로 이동(오프로딩)시키는 기능입니다.

* **작동 방식 분석:** 이는 llama.cpp의 '레이어 오프로딩'과는 근본적으로 다릅니다. 레이어를 CPU에 두는 것이 아니라, GPU 사용률이 한계에 도달했을 때 PagedAttention 블록(KV 캐시)을 저장하기 위한 '오버플로우 공간(overflow space)'으로 CPU RAM을 사용하는 것입니다.
* **성능 영향:** GPU-CPU 간의 PCIe 버스 통신은 GPU-GPU(NVLink) 또는 HBM 메모리 대역폭보다 훨씬 느립니다. 따라서 오프로딩/스와핑이 발생하는 시점에는 상당한 지연 시간(latency)이 발생합니다. 이 기능은 성능 *향상*이 목적이 아니라, OOM(Out-of-Memory)을 방지하고 더 긴 컨텍스트를 처리하기 위한 **최후의 수단**입니다.
* **v0.11.0 활성화 방법:**
  * v0.11.0 API 문서는 CacheConfig 또는 CLI 인수를 통해 kv_offloading_backend를 설정하여 이 기능을 활성화할 수 있음을 보여줍니다.
  * --kv-offloading-backend native: vLLM V1의 네이티브(in-house) CPU 오프로딩 솔루션을 사용합니다.
  * --kv-offloading-backend lmcache: (참고) LMCache 와 같은 외부 백엔드를 플러그인 형태로 사용할 수도 있습니다.

## **vLLM 코드베이스 아키텍처 개요**

vLLM은 온라인(API)과 오프라인(LLM 클래스) 모드가 동일한 핵심 엔진을 공유하는 효율적인 구조를 가집니다.
v0.11.0 (V1 엔진) 기준 핵심 컴포넌트는 다음과 같습니다.

1. **Engine (vllm/engine/):**
   * LLMEngine: 시스템의 중앙 두뇌. 모든 상태를 관리하고 스케줄러와 워커를 조율합니다.
   * AsyncLLMEngine: LLMEngine의 비동기(asyncio) 래퍼(wrapper)입니다. API 서버는 이 클래스를 사용하여 비동기 요청을 처리합니다.
2. **Scheduler (vllm/core/scheduler.py):**
   * vLLM의 *심장*입니다. PagedAttention과 연속적 배칭을 실제로 구현하는 로직이 여기에 있습니다.
   * 요청 큐(waiting, running, swapped)를 관리하며, 매 스텝마다 어떤 시퀀스 그룹(sequence group)을 실행할지, 어떤 물리적 KV 블록을 할당/해제/스와핑할지 결정합니다.
3. **Worker (vllm/worker/worker.py):**
   * 각 GPU를 관리하는 별도의 프로세스(또는 텐서 병렬 처리 시 스레드 그룹)입니다.
   * GPU 디바이스 초기화, 모델 가중치 로드, 그리고 엔진으로부터 '실행' 명령을 받아 Model Runner를 호출하는 역할을 합니다.
4. **Model Runner (vllm/model_executor/):**
   * 워커 내부에 존재하며, 실제 torch.nn.Module로 구현된 모델 객체를 소유합니다.
   * 스케줄러로부터 전달받은 배치 정보(예: slot_mapping)를 기반으로 실제 모델의 forward 패스를 실행(예: execute_model)합니다.

## **vLLM v0.11.0 온프레미스 배포를 위한 전략**

1. **이론과 실제의 결합:** vLLM의 경이로운 처리량은 PagedAttention 11이라는 이론적 혁신과 연속적 배치 처리 라는 실제적 구현의 결합체입니다. 이는 커널 수준의 미세한 오버헤드(약 20-26%)를 감수하는 대신, 시스템 전체의 메모리 단편화를 4% 미만으로 줄여 GPU 활용률을 극대화하는 고전적인 시스템 엔지니어링의 승리입니다.
2. **v0.11.0의 명확한 장단점:** v0.11.0은 V1 엔진으로의 아키텍처 통합을 완료하고 KV 캐시 CPU 오프로딩과 같은 고급 기능을 도입한 중요한 릴리스입니다. 하지만, 이 버전에는 --async-scheduling 활성화 시 출력이 손상되는 치명적인 버그가 존재합니다. 온프레미스 관리자는 이 버그를 명확히 인지하고 해당 기능을 **반드시 비활성화**해야 합니다.
3. **Docker 배포의 핵심:** 온프레미스 Docker 배포 시, docker run 명령어에 --ipc=host 또는 --shm-size 를 명시하는 것은 단순한 옵션이 아닙니다. 이는 PyTorch의 프로세스 간 통신을 위해 필수적이며, 특히 텐서 병렬 처리를 구성할 때는 이 설정이 누락될 경우 배포가 반드시 실패합니다.
4. **고급 기능의 트레이드오프:** vLLM의 고급 기능들은 '공짜 점심'이 아닙니다.
   * **Multi-LoRA**는 유연성을 제공하지만, --max-lora-rank 를 통해 KV 캐시가 사용할 수 있는 메모리를 정적으로 *선점*하는 비용을 청구합니다.
   * **KV 캐시 오프로딩** OOM을 방지하지만, PCIe 대역폭의 한계로 인해 상당한 *지연 시간*을 대가로 요구합니다.
