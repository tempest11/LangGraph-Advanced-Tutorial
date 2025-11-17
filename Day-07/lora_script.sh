# Serve
VLLM_ALLOW_RUNTIME_LORA_UPDATING=True \
    uv run vllm serve Qwen/Qwen3-0.6B \
    --max-model-len 8192 \
    --reasoning-parser qwen3 \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --enable-lora

# Load
curl -X POST http://localhost:8000/v1/load_lora_adapter \
    -H "Content-Type: application/json" \
    -d '{"lora_name": "qwen/Qwen3-0.6B-SAMPLE-Lora", "lora_path": "qwen/Qwen3-0.6B-SAMPLE-Lora"}'


# Unload
curl -X POST http://localhost:8000/v1/unload_lora_adapter \
    -H "Content-Type: application/json" \
    -d '{"lora_name": "qwen/Qwen3-0.6B-SAMPLE-Lora"}'