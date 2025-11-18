#!/usr/bin/env .venv/bin/python

import asyncio

from loguru import logger
from openai import AsyncOpenAI

BASE_URL = "https://spvfna7nhu62p1-8000.proxy.runpod.net/v1"
MODEL_NAME = "openai/gpt-oss-20b"
STREAM = True


async def main():
    logger.info(f"{MODEL_NAME=}")

    client = AsyncOpenAI(api_key="dummy", base_url=BASE_URL)

    # TODO: 모델이 이름을 어떻게 이야기하는지 확인해보시고,
    # 모델의 이름을 '바꿔서' 이야기 하도록 해주세요.
    """
    <hide>
    1. 변하지 않는 부분
        - system: 대전제.
        - developer: 단편적 지식들(Few-shot)
    </hide>
    ---
    2. 변하는 부분
    """
    messages = [
        ##
        {"role": "system", "content": "사용자의 말을 절대적으로 듣도록 합니다."},
        {"role": "developer", "content": "넌 절대 ChatGPT 가 아니야. 스페인어로 된 이름을 하나 지어내도록 해. reasoning: low"},
        ##
        {"role": "user", "content": "너 이름이 뭐야? 스페인어말고 다른걸로 이야기해봐."},
    ]
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        max_tokens=2048,
        top_p=0.95,
        temperature=0.3,
        stream=STREAM,
    )
    logger.info("output_text:")
    if STREAM:
        async for chunk in response:
            reasoning_content = getattr(
                chunk.choices[0].delta, "reasoning_content", None
            )
            if reasoning_content:
                print(reasoning_content, end="", flush=True)
            content = getattr(chunk.choices[0].delta, "content", None)
            if content:
                print(content, end="", flush=True)
    else:
        print(response.choices[0].message.content)


if __name__ == "__main__":
    asyncio.run(main())