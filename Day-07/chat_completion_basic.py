#!/usr/bin/env .venv/bin/python

import asyncio

from loguru import logger
from openai import AsyncOpenAI

BASE_URL = "http://localhost:8000/v1"
MODEL_NAME = "Qwen/Qwen3-0.6B"
STREAM = True


async def main():
    logger.info(f"{MODEL_NAME=}")

    client = AsyncOpenAI(api_key=None, base_url=BASE_URL)

    # NOTE: serve_model_name을 모를 때 아래 API를 통해 Model Name 받아서 사용 가능
    # GET /v1/models
    # models = await client.models.list()
    # logger.info(models.data[0].id)

    messages = [
        {"role": "user", "content": "Hi~ Samsung SDS"},
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