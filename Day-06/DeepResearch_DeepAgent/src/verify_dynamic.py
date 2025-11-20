"""Verification script for Dynamic Sub-Agent functionality."""

import sys
import os
from unittest.mock import MagicMock

# Mock missing dependencies
sys.modules["deepagents"] = MagicMock()
sys.modules["deepagents.backends"] = MagicMock()
sys.modules["langchain_mcp_adapters"] = MagicMock()
sys.modules["langchain_mcp_adapters.client"] = MagicMock()

# Add src to path
sys.path.append(os.path.join(os.getcwd(), "src"))

from skills.registry import registry
from tools.subagent_tools import SpawnSubAgent
from langchain_core.tools import Tool

def test_registry():
    print("Testing SkillRegistry...")
    
    # Register a mock tool
    mock_tool = Tool(name="tavily_search", description="Mock search", func=lambda x: "search result")
    registry.register_tool(mock_tool)
    
    # Check if we can retrieve it via skill
    tools = registry.get_tools_for_skill("web_research")
    assert len(tools) == 1
    assert tools[0].name == "tavily_search"
    print("Registry test passed!")

def test_spawn_tool_instantiation():
    print("Testing SpawnSubAgent instantiation...")
    tool = SpawnSubAgent()
    assert tool.name == "spawn_subagent"
    print("SpawnSubAgent instantiation passed!")

def test_dynamic_factory_mock():
    print("Testing Dynamic Factory (Mocked)...")
    from subagents.dynamic import create_dynamic_subagent
    
    # Mock tools
    tools = [Tool(name="test_tool", description="test", func=lambda x: x)]
    
    # Since deepagents is mocked, this should just run without error and return the mock
    agent = create_dynamic_subagent("test_agent", "test_goal", tools)
    assert isinstance(agent, MagicMock)
    print("Dynamic Factory test passed!")

if __name__ == "__main__":
    test_registry()
    test_spawn_tool_instantiation()
    test_dynamic_factory_mock()
