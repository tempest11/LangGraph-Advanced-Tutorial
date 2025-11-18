#!/usr/bin/env .venv/bin/python

import asyncio
import sys
from datetime import datetime
from typing import Any, Dict, List

from langchain.agents import create_agent
from langchain.tools import BaseTool
from langchain_openai import ChatOpenAI
from loguru import logger

read = sys.stdin.readline

BASE_URL = "http://localhost:8000/v1"
MODEL_NAME = "Qwen/Qwen3-0.6B"
STREAM = True  # 스트리밍 출력 사용


# LangChain Tool 정의
class WeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = "특정 도시의 현재 날씨 정보를 가져옵니다"

    def _run(self, city: str) -> str:
        """특정 도시의 날씨 정보를 가져옵니다."""
        weather_data = {
            "서울": "맑음, -10°C, 습도 45%",
            "부산": "흐림, 5°C, 습도 60%",
            "대구": "비, 10°C, 습도 85%",
            "인천": "맑음, -8°C, 습도 50%",
            "광주": "흐림, 7°C, 습도 55%",
            "대전": "맑음, 4°C, 습도 40%",
            "울산": "흐림, 8°C, 습도 65%",
            "제주": "맑음, 10°C, 습도 70%",
        }
        return weather_data.get(city, f"{city}의 날씨 정보를 찾을 수 없습니다.")


class CalculatorTool(BaseTool):
    name: str = "calculate"
    description: str = "수학 계산을 수행합니다"

    def _run(self, expression: str) -> str:
        """수학 계산을 수행합니다."""
        try:
            allowed_chars = set("0123456789+-*/.() ")
            if not all(c in allowed_chars for c in expression):
                return "안전하지 않은 문자가 포함되어 있습니다."

            result = eval(expression)
            return f"{expression} = {result}"
        except Exception as e:
            return f"계산 오류: {str(e)}"


class TimeTool(BaseTool):
    name: str = "get_current_time"
    description: str = "현재 날짜와 시간을 가져옵니다"

    def _run(self) -> str:
        """현재 시간을 가져옵니다."""
        current_time = datetime.now()
        return f"현재 시간: {current_time.strftime('%Y년 %m월 %d일 %H시 %M분 %S초')}"


class NewsSearchTool(BaseTool):
    name: str = "search_news"
    description: str = "특정 주제의 최신 뉴스를 검색합니다"

    def _run(self, topic: str) -> str:
        """특정 주제의 뉴스를 검색합니다."""
        news_data = {
            "AI": [
                "한국형 AI 반도체 개발 프로젝트 본격 시동",
                "AI 윤리 가이드라인 국제 표준화 논의 활발",
            ],
            "파이썬": [
                "Python 3.14 정식 릴리스, 성능 대폭 개선",
                "FastAPI 0.112.0 출시로 기대감",
            ],
            "기술": [
                "양자컴퓨터 상용화, 2030년대 현실화 전망",
                "블록체인 플랫폼, 금융 분야 적용 확산",
            ],
            "경제": [
                "반도체 시장 회복세, 슈퍼사이클 도래해",
                "디지털 화폐 규제 방안 정부 차원에서 검토",
            ],
        }

        for keyword, articles in news_data.items():
            if keyword.lower() in topic.lower() or topic.lower() in keyword.lower():
                return f"{keyword} 관련 최신 뉴스:\n" + "\n".join(
                    [f"• {article}" for article in articles]
                )

        return f"'{topic}' 관련 뉴스를 찾을 수 없습니다. 다른 주제를 시도해보세요."


class RestaurantTool(BaseTool):
    name: str = "get_restaurant_recommendations"
    description: str = "특정 지역의 맛집을 추천합니다"

    def _run(self, location: str, cuisine_type: str = "한식") -> str:
        """특정 지역의 맛집을 추천합니다."""
        restaurants = {
            "서울": {
                "한식": ["광화문 한정식", "명동 갈비집", "강남 삼계탕"],
                "중식": ["차이나타운 짜장면", "홍콩반점", "북경반점"],
                "일식": ["스시 야마", "라멘 타로", "돈카츠 마츠"],
            },
            "부산": {
                "한식": ["해운대 회센터", "광안리 갈비", "서면 냉면"],
                "해산물": ["자갈치 활어회", "민락수변공원 회", "해동용궁 멸치쌈밥"],
            },
            "제주": {
                "한식": ["제주 흑돼지", "올레국수", "성산 해물탕"],
                "해산물": ["성산포 활전복", "우도 해물라면", "표선 갈치조림"],
            },
        }

        if location in restaurants:
            if cuisine_type in restaurants[location]:
                recs = restaurants[location][cuisine_type]
                return f"{location} {cuisine_type} 맛집 추천:\n" + "\n".join(
                    [f"• {restaurant}" for restaurant in recs]
                )
            else:
                available = list(restaurants[location].keys())
                return f"{location}에서는 {', '.join(available)} 음식을 추천할 수 있습니다."

        return f"{location}의 맛집 정보가 없습니다."


# LangChain Tool 인스턴스들
LANGCHAIN_TOOLS = [
    WeatherTool(),
    CalculatorTool(),
    TimeTool(),
    NewsSearchTool(),
    RestaurantTool(),
]


async def langchain_streaming_chat(
    model: ChatOpenAI, 
    messages: List[Dict[str, Any]],
) -> str:
    """LangChain Agent를 사용한 스트리밍 채팅 함수"""

    system_prompt = """당신은 도움이 되는 AI 어시스턴트입니다. 
사용자의 요청에 따라 적절한 도구를 사용하여 정확하고 유용한 정보를 제공하세요.
항상 한국어로 친절하고 자세하게 답변해주세요."""

    # LangChain Agent 생성
    agent = create_agent(model, LANGCHAIN_TOOLS, system_prompt=system_prompt)

    # 사용자 메시지 추출
    user_message = None
    for msg in messages:
        if msg.get("role") == "user":
            user_message = msg.get("content")
            break

    if not user_message:
        return "사용자 메시지를 찾을 수 없습니다."

    try:
        result = await agent.ainvoke({"messages": [user_message]})
        return result.content
    except Exception as e:
        logger.error(f"LangChain Agent 실행 실패: {str(e)}")
        return f"오류가 발생했습니다: {str(e)}"


async def interactive_tool_calling():
    """대화형 Tool Calling 모드"""

    # vLLM 서버와 연결되는 ChatOpenAI 설정
    client = ChatOpenAI(
        model=MODEL_NAME,
        base_url=BASE_URL,
        api_key="dummy",  # vLLM에서는 실제 API 키가 필요 없음
        temperature=0.3,
        max_tokens=1024,
        streaming=True,  # 스트리밍 활성화
    )

    logger.info(f"사용 가능한 도구: {len(LANGCHAIN_TOOLS)}개")

    logger.info("=" * 60)
    logger.info("대화형 LangChain Tool Calling 모드")
    logger.info("사용 가능한 기능:")
    logger.info("• 날씨 정보 (예: 서울 날씨 알려줘)")
    logger.info("• 계산기 (예: 123 + 456을 계산해줘)")
    logger.info("• 현재 시간 (예: 지금 몇 시야?)")
    logger.info("• 뉴스 검색 (예: AI 뉴스 찾아줘)")
    logger.info("• 맛집 추천 (예: 부산 해산물 맛집 추천해줘)")
    logger.info("• 종료하려면 'quit' 또는 'exit' 입력")
    logger.info("=" * 60)

    # 대화 히스토리 유지
    conversation_history = [
        {
            "role": "system",
            "content": """당신은 도움이 되는 AI 어시스턴트입니다.
사용자의 요청에 따라 적절한 도구를 사용하여 정확하고 유용한 정보를 제공하세요.
이전 대화 내용을 기억하고 맥락을 고려하여 답변해주세요.
항상 한국어로 친절하고 자세하게 답변해주세요.""",
        }
    ]

    conversation_count = 0

    while True:
        try:
            logger.info("사용자: ")
            user_input = read().strip()

            if user_input.lower() in ["quit", "exit", "종료", "나가기"]:
                logger.info(
                    f"사용자 종료 요청. 총 {conversation_count}번의 대화 완료"
                )
                logger.info("대화를 종료합니다. 안녕히 가세요!")
                break

            if not user_input:
                continue

            conversation_count += 1
            logger.info(f"대화 {conversation_count}: 사용자 입력 - {user_input}")

            # 사용자 메시지 추가
            conversation_history.append({"role": "user", "content": user_input})

            # LangChain Agent로 응답 생성
            logger.info(f"대화 {conversation_count}: AI 응답 생성 시작")
            print("", end="", flush=True)

            result = await langchain_streaming_chat(client, conversation_history.copy())

            # 스트리밍 효과를 위해 글자별로 출력
            for char in result:
                print(char, end="", flush=True)
                await asyncio.sleep(0.01)  # 스트리밍 효과
            print()  # 줄바꿈

            logger.info(f"대화 {conversation_count}: AI 응답 생성 완료")

            # 어시스턴트 응답을 히스토리에 추가
            conversation_history.append({"role": "assistant", "content": result})

            # 대화 히스토리가 너무 길어지면 줄이기 (시스템 메시지 + 최근 10개 메시지)
            if len(conversation_history) > 11:
                removed_count = len(conversation_history) - 11
                conversation_history = [conversation_history[0]] + conversation_history[
                    -10:
                ]
                logger.info(f"대화 히스토리 정리: {removed_count}개 메시지 제거")

        except KeyboardInterrupt:
            logger.info("사용자가 Ctrl+C로 강제 종료")
            logger.info("대화를 종료합니다. 안녕히 가세요!")
            break
        except Exception as e:
            logger.error(f"대화 {conversation_count} 중 오류 발생: {str(e)}")
            logger.error(f"죄송합니다. 오류가 발생했습니다: {str(e)}")


async def main():
    logger.info(f"모델: {MODEL_NAME}")
    logger.info(f"서버: {BASE_URL}")

    try:
        await interactive_tool_calling()

    except Exception as e:
        logger.error(f"실행 중 오류 발생: {str(e)}")
        logger.error(f"오류: {str(e)}")
        logger.error("vLLM 서버가 실행 중인지 확인해주세요:")


if __name__ == "__main__":
    asyncio.run(main())