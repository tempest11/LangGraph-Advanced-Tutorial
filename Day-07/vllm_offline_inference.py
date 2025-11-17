#!/usr/bin/env .venv/bin/python

from loguru import logger
from vllm import LLM, SamplingParams

MODEL_NAME = "Qwen/Qwen3-0.6B"

def main():
    logger.info(f"{MODEL_NAME=}")

    llm = LLM(model=MODEL_NAME, max_model_len=2048)
    messages = [
        {"role": "user", "content": "Hello, Samsung SDS"},
    ]
    sampling_params = SamplingParams(top_p=0.95, temperature=0.3, max_tokens=2048)
    outputs = llm.chat(messages, sampling_params=sampling_params)
    for output in outputs:
        logger.info("output_text:")
        print(output.outputs[0].text)


if __name__ == "__main__":
    main()