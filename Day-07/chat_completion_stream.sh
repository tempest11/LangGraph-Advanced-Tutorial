#!/bin/bash

curl -X POST http://localhost:8000/v1/chat/completions \
	-H "Content-Type: application/json" \
	-d '{
    "model": "Qwen/Qwen3-0.6B",
    "messages": [
        {
            "role": "user",
            "content": "안녕하세요? 스트리밍"
        }
    ],
    "stream": true
}'

# data: {"id":"","object":"chat.completion.chunk","created":1754911477,"model":"Qwen/Qwen3-0.6B","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}
#
# data: {"id":"","object":"chat.completion.chunk","created":1754911477,"model":"Qwen/Qwen3-0.6B","choices":[{"index":0,"delta":{"content":"<think>"},"logprobs":null,"finish_reason":null}]}
#
# ...
#
# data: {"id":"","object":"chat.completion.chunk","created":1754911477,"model":"Qwen/Qwen3-0.6B","choices":[{"index":0,"delta":{"content":"안녕,"},"logprobs":null,"finish_reason":null}]}
#
# data: {"id":"","object":"chat.completion.chunk","created":1754911477,"model":"Qwen/Qwen3-0.6B","choices":[{"index":0,"delta":{"content":"하세요."},"logprobs":null,"finish_reason":"stop","stop_reason":null}]}
#
# data: [DONE]