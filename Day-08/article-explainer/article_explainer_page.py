"""
Article Explainer Streamlit 웹 애플리케이션 메인 파일

SWARM 패턴에서의 역할:
    - 사용자 인터페이스 제공 (Streamlit)
    - PDF 문서 업로드 및 처리
    - SwarmState 초기화 및 관리
    - SWARM 에이전트 시스템과의 상호작용
    - 채팅 인터페이스로 사용자 쿼리 및 응답 처리

주요 기능:
    1. PDF 문서 업로드 및 텍스트 추출
    2. SwarmState에 문서 컨텍스트 저장
    3. 사용자 질문을 SWARM 에이전트에 전달
    4. 에이전트 응답을 채팅 UI로 표시
"""

import os
import tempfile

import streamlit as st
from explainer.graph import app  # 컴파일된 SWARM 애플리케이션
from explainer.service.content_loader import ContentLoader  # PDF 문서 로더
from langchain_core.messages import HumanMessage  # LangChain 메시지 클래스
from langgraph_swarm import SwarmState  # SWARM 상태 관리 객체
from streamlit_pdf_viewer import pdf_viewer


def _process_pdf_upload(uploaded_file) -> str | None:
    """
    업로드된 PDF 파일을 처리하고 문서 컨텐츠를 반환하는 함수

    이 함수는 Streamlit에서 업로드한 PDF 파일을 임시 디렉토리에 저장하고,
    ContentLoader를 사용하여 텍스트를 추출한 후, 임시 파일을 삭제합니다.

    Args:
        uploaded_file (streamlit.runtime.uploaded_file_manager.UploadedFile):
            Streamlit의 file_uploader로부터 받은 업로드 파일 객체
            - 지원 형식: .pdf
            - getbuffer() 메서드로 파일 바이트 데이터 접근 가능

    Returns:
        str | None: 추출된 문서 텍스트 (청크 결합된 평문) 또는 에러 시 None
                    - 성공 시: max_chunks=10개 청크를 \n\n으로 연결한 텍스트
                    - 실패 시: None 반환 및 Streamlit 에러 메시지 표시

    Raises:
        Exception: PDF 파싱 실패 시 (잘못된 PDF 형식, 암호화된 파일 등)
                  - 에러는 try-except로 캐치되어 st.error()로 사용자에게 표시됨

    Example:
        >>> uploaded_file = st.file_uploader("Upload PDF", type=["pdf"])
        >>> if uploaded_file:
        >>>     content = _process_pdf_upload(uploaded_file)
        >>>     if content:
        >>>         st.session_state.document_content = content

    Note:
        - max_chunks=10으로 제한하여 LLM 컨텍스트 창 크기 관리
        - 임시 파일은 처리 후 자동으로 삭제됨 (finally 블록에서 보장)
        - 파일명 충돌 방지를 위해 "uploaded_" 접두사 추가
    """
    if uploaded_file is None:
        return None

    # 시스템 임시 디렉토리에 PDF 파일 저장
    temp_dir = tempfile.gettempdir()
    temp_file_path = os.path.join(temp_dir, f"uploaded_{uploaded_file.name}")

    # 업로드된 파일을 임시 위치에 쓰기
    with open(temp_file_path, "wb") as f:
        f.write(uploaded_file.getbuffer())

    # ContentLoader를 사용하여 PDF 텍스트 추출
    loader = ContentLoader()
    try:
        # max_chunks=10: 처음 10개 청크만 사용하여 LLM 컨텍스트 크기 제한
        document_content = loader.get_text(temp_file_path, max_chunks=10)
        return document_content
    except Exception as e:
        st.error(f"Error processing PDF: {str(e)}")
        return None
    finally:
        # 임시 파일 정리 (보안 및 디스크 공간 관리)
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def main():
    """
    Streamlit 웹 애플리케이션의 메인 함수

    이 함수는 전체 UI를 구성하고 SWARM 에이전트 시스템과의 상호작용을 관리합니다.

    실행 흐름:
        1. 페이지 설정 및 세션 상태 초기화
           - st.session_state.messages: 채팅 메시지 이력
           - st.session_state.document_content: 추출된 PDF 텍스트
           - st.session_state.agent_state: SWARM 에이전트 상태 (SwarmState 객체)
           - st.session_state.uploaded_pdf_bytes: PDF 미리보기용 바이너리 데이터

        2. 사이드바에 PDF 업로더 표시
           - PDF 업로드 및 처리 (ContentLoader 사용)
           - SwarmState 초기화 (문서 컨텍스트를 초기 메시지로 설정)

        3. 메인 영역에 채팅 인터페이스 렌더링
           - PDF 미리보기 (확장 가능한 섹션)
           - 기존 채팅 이력 표시
           - 사용자 입력창

        4. SWARM 에이전트 실행 및 응답 처리
           - 사용자 질문을 SwarmState에 추가
           - app.invoke()로 에이전트 그래프 실행
           - 에이전트 응답을 채팅 UI에 표시

    SWARM 패턴 통합:
        - SwarmState는 문서 컨텍스트와 대화 이력을 모두 포함
        - 첫 번째 메시지는 항상 "[Document content] : ..." 형식의 문서 전체 텍스트
        - 이후 메시지는 사용자-에이전트 간 대화 기록
        - 모든 에이전트가 동일한 SwarmState를 공유하여 문서 컨텍스트에 접근

    Note:
        - Streamlit은 상태를 유지하지 않으므로 session_state 사용 필수
        - app.invoke()는 동기적으로 실행되며 전체 에이전트 체인이 완료될 때까지 대기
        - 에러 발생 시 st.error()로 사용자 친화적인 메시지 표시
    """
    # Streamlit 페이지 기본 설정
    st.set_page_config(page_title="Article Explainer", page_icon="📚", layout="wide")

    # ========================================
    # 세션 상태 초기화
    # ========================================
    # Streamlit은 페이지 재로드 시마다 상태를 유지하기 위해 session_state 사용
    if "messages" not in st.session_state:
        st.session_state.messages = []  # 채팅 메시지 이력
    if "document_content" not in st.session_state:
        st.session_state.document_content = None  # 추출된 PDF 텍스트
    if "agent_state" not in st.session_state:
        st.session_state.agent_state = None  # SWARM 에이전트 상태
    if "uploaded_pdf_bytes" not in st.session_state:
        st.session_state.uploaded_pdf_bytes = None  # PDF 미리보기용 바이트

    # ========================================
    # 사이드바: PDF 업로드 영역
    # ========================================
    with st.sidebar:
        st.header("📚 Article Explainer")
        uploaded_file = st.file_uploader(type="pdf", label="Document Uploader")

        if uploaded_file is not None:
            # 문서가 아직 처리되지 않았으면 처리 실행
            if st.session_state.document_content is None:
                with st.spinner("Processing PDF..."):
                    # PDF 바이트 데이터 저장 (미리보기용)
                    st.session_state.uploaded_pdf_bytes = uploaded_file.read()

                    # PDF 텍스트 추출
                    document_content = _process_pdf_upload(uploaded_file)
                    if document_content:
                        st.session_state.document_content = document_content
                        st.toast("PDF processed with success")

                        # ========================================
                        # SwarmState 초기화 (SWARM 패턴의 핵심)
                        # ========================================
                        # 문서 컨텍스트를 초기 메시지로 추가
                        # 모든 에이전트가 이 문서 컨텍스트를 공유하게 됨
                        context_message = f"[Document content] : {document_content}"
                        st.session_state.agent_state = SwarmState(
                            messages=[{"role": "user", "content": context_message}],
                        )

                        # 초기 인사 메시지 추가
                        if not st.session_state.messages:
                            st.session_state.messages = [
                                {
                                    "role": "assistant",
                                    "content": "Hello, what can I help you with?",
                                }
                            ]

    # ========================================
    # 메인 컨텐츠 영역
    # ========================================
    if st.session_state.document_content is not None:
        # PDF 미리보기 (Expander로 선택적 표시)
        with st.expander("📖 View document", expanded=False):
            if st.session_state.uploaded_pdf_bytes:
                pdf_viewer(st.session_state.uploaded_pdf_bytes, height=600)

        # 기존 채팅 메시지 표시
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

        # 사용자 입력 처리
        if prompt := st.chat_input("Ask me anything about the document..."):
            # 사용자 메시지를 세션 상태에 추가
            st.session_state.messages.append({"role": "user", "content": prompt})
            with st.chat_message("user"):
                st.markdown(prompt)

            # ========================================
            # SWARM 에이전트 실행 및 응답 처리
            # ========================================
            with st.chat_message("assistant"):
                with st.spinner("Thinking..."):
                    try:
                        # 1. 사용자 메시지를 SwarmState에 추가
                        st.session_state.agent_state["messages"].append(
                            HumanMessage(content=prompt)
                        )

                        # 2. SWARM 애플리케이션 실행
                        # app.invoke()는 전체 에이전트 그래프를 실행합니다.
                        # 기본 에이전트(Explainer)가 먼저 실행되고,
                        # 필요시 다른 에이전트로 handoff됩니다.
                        response_state = app.invoke(st.session_state.agent_state)

                        # 3. 새로운 상태로 업데이트 (에이전트 응답 포함)
                        st.session_state.agent_state = response_state

                        # 4. 가장 최근 메시지 (에이전트 응답) 추출
                        last_msg = response_state["messages"][-1]
                        response_content = last_msg.content

                        # 5. 응답 표시
                        st.markdown(response_content)

                        # 6. 채팅 이력에 저장
                        st.session_state.messages.append(
                            {"role": "assistant", "content": response_content}
                        )

                    except Exception as e:
                        # 에러 처리
                        error_message = f"Sorry, I encountered an error: {str(e)}"
                        st.error(error_message)
                        st.session_state.messages.append(
                            {"role": "assistant", "content": error_message}
                        )

    else:
        # 문서가 업로드되지 않았을 때 사용 안내 표시
        with st.expander("ℹ️ How to use this app"):
            st.markdown("""
            1. **Upload a document**: Use the sidebar to upload your PDF document
            2. **Wait for processing**: The app will extract and process the content
            3. **Start chatting**: Ask questions about the document content
            4. **Get expert answers**: The agentic team will provide detailed explanations, analogies, summaries, or technical breakdowns

            **SWARM 에이전트 팀**:
            - 📖 Explainer: 단계별 상세 설명
            - 💻 Developer: 코드 예제 제공
            - 📝 Summarizer: 간결한 요약
            - 🎨 Analogy Creator: 쉽운 비유 설명
            - 🔍 Vulnerability Expert: 비판적 분석
            """)


# ========================================
# 애플리케이션 실행 진입점
# ========================================
if __name__ == "__main__":
    main()
