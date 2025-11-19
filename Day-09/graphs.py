from typing import TypedDict, Annotated
from langchain.agents import create_agent
from langgraph.graph import StateGraph
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
# FakeChatModel
from langchain_core.language_models.fake_chat_models import FakeChatModel

fake_model = FakeChatModel()

agent = create_agent(
    fake_model,
    []
)

class SampleState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

workflow = StateGraph(state_schema=SampleState)
workflow.add_node("첫번째", lambda x: x)
workflow.add_node("두번째", lambda x: x)

workflow.set_entry_point("첫번째")
workflow.add_edge("첫번째", "두번째")
workflow.set_finish_point("두번째")

sample_graph = workflow.compile()