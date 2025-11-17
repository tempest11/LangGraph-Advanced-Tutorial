#!/bin/bash

curl -X POST http://localhost:8000/v1/chat/completions \
	-H "Content-Type: application/json" \
	-d '{
    "model": "Qwen/Qwen3-0.6B",
    "messages": [
        {
            "role": "user",
            "content": "Non Thinking Mode Hello Samsung SDS"
        }
    ],
    "chat_template_kwargs": {"enable_thinking": false}
}' | jq
