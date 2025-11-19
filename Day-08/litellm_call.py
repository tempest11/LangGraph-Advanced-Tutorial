from openai import OpenAI
from langchain.chat_models import init_chat_model
from langchain.agents.middleware import PIIMiddleware, wrap_model_call
from langchain.agents import create_agent

pii = PIIMiddleware(
    "email",
    strategy="redact",
)

@wrap_model_call
def qwen3_guard(request, handler):
    "개발~"
    pass

create_agent(
    "",
    [],
    middleware=[
        pii
    ]
)

BASE_URL = "http://localhost:4000"
API_KEY = "sk-xQ-8bApmT-e2Mq6NLJ3udg"

# client = OpenAI(
#     api_key=API_KEY,
#     base_url=BASE_URL
# )
# model = init_chat_model(
#     "anthropic:claude-sonnet-4.5", 
#     model_provider="anthropic", 
#     base_url=BASE_URL, 
#     api_key=API_KEY
# )
# """
# anthropic.BadRequestError: Error code: 400 - {'error': {'message': "400: 
# {'error': 'completion: Invalid model name passed in model=claude-sonnet-4.5'}", 
# 'type': 'None', 'param': 'None', 'code': '400'}}
# """
# result = client.completions.create(
#     model="z-ai:glm-4.6",
#     prompt="hello"
# )
result = model.invoke("안녕~")
print(result)

