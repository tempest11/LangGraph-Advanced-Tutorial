"""
파일명: content_loader.py
설명: PDF 문서를 로드하고 텍스트를 청크로 분할하는 유틸리티 클래스

SWARM 패턴에서의 역할:
    - PDF 문서에서 텍스트 추출
    - LLM 컨텍스트 창에 맞게 텍스트 청킹
    - SwarmState에 저장될 문서 컨텍스트 준비
"""

from langchain.schema import Document
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


class ContentLoader:
    """
    PDF 문서에서 텍스트를 로드하고 준비하는 클래스

    PyPDFLoader를 사용하여 PDF 파일을 로드하고,
    RecursiveCharacterTextSplitter로 텍스트를 의미 있는 청크로 분할합니다.

    청킹 전략:
        - 문장이나 단락의 의미를 유지하면서 분할
        - 청크 간 약간의 겹침으로 컨텍스트 연속성 보장
        - LLM 컨텍스트 창 크기에 맞게 크기 제한

    RecursiveCharacterTextSplitter 동작 원리:
        1. 먼저 단락 구분자("\\n\\n")로 분할 시도
        2. 청크가 여전히 크면 문장 구분자("\\n")로 분할
        3. 그래도 크면 문장 구분자(". ")로 분할
        4. 최종적으로 단어 구분자(" ")로 분할
        → 이를 통해 의미 단위를 최대한 보존

    청킹 파라미터:
        - chunk_size=1000: 각 청크의 최대 문자 수
        - chunk_overlap=100: 청크 간 겹치는 문자 수
        - 겹침은 문맥 유실을 방지하고 경계 부분의 정보를 보존

    SWARM 패턴에서의 역할:
        - PDF 문서를 SwarmState에 저장할 수 있는 텍스트로 변환
        - 모든 에이전트가 공유할 문서 컨텍스트 준비
        - LLM 컨텍스트 창 크기 제한을 고려한 청크 관리

    Example:
        >>> loader = ContentLoader(chunk_size=500, chunk_overlap=50)
        >>> # 작은 청크로 더 세밀한 분할
        >>>
        >>> docs = loader.load("research_paper.pdf")
        >>> print(f"총 {len(docs)}개 청크로 분할됨")
        >>>
        >>> text = loader.get_text("research_paper.pdf", max_chunks=5)
        >>> print(f"처음 5개 청크 텍스트 길이: {len(text)} 문자")
    """

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 100):
        """
        ContentLoader 초기화

        Args:
            chunk_size (int): 각 청크의 최대 문자 수. 기본값 1000
            chunk_overlap (int): 청크 간 겹치는 문자 수. 기본값 100
                                 겹침은 컨텍스트 연속성을 유지하기 위해 필요
        """
        # RecursiveCharacterTextSplitter: 재귀적으로 문자를 분할하여 의미 단위 유지
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,  # 청크 크기
            chunk_overlap=chunk_overlap,  # 청크 간 겹침
        )

    def load(self, file_path: str) -> list[Document]:
        """
        파일에서 컨텐츠를 로드하고 분할하는 메서드

        Args:
            file_path (str): 로드할 PDF 파일의 경로

        Returns:
            List[Document]: 분할된 문서 청크 리스트
                           각 Document 객체는 page_content와 metadata를 포함

        Raises:
            ValueError: 지원하지 않는 파일 형식일 경우
        """
        # PDF 파일 형식 확인 및 로더 생성
        if file_path.endswith(".pdf"):
            loader = PyPDFLoader(file_path)  # PyPDF 라이브러리를 사용하여 PDF 파싱
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        # PDF에서 문서 로드 (페이지별로 분리됨)
        docs = loader.load()

        # RecursiveCharacterTextSplitter로 더 작은 청크로 분할
        # 이는 LLM이 처리할 수 있는 크기로 만듦
        return self.splitter.split_documents(docs)

    def get_text(self, file_path: str, max_chunks: int = None) -> str:
        """
        컨텐츠를 로드하고 연결된 평문 텍스트로 반환하는 메서드

        Args:
            file_path (str): 로드할 PDF 파일의 경로
            max_chunks (int, optional): 최대 사용할 청크 수.
                                        None이면 모든 청크 사용.
                                        LLM 컨텍스트 크기 제한을 위해 사용.

        Returns:
            str: 모든 청크를 \n\n으로 연결한 텍스트

        Example:
            >>> loader = ContentLoader()
            >>> text = loader.get_text("document.pdf", max_chunks=10)
            >>> # 처음 10개 청크만 사용하여 텍스트 추출
        """
        # 문서 로드 및 청크로 분할
        docs = self.load(file_path)

        # max_chunks가 지정되면 처음 N개 청크만 사용
        # 이는 매우 큰 문서에서 LLM 컨텍스트 크기를 초과하지 않기 위함
        if max_chunks:
            docs = docs[:max_chunks]

        # 모든 청크의 텍스트를 \n\n으로 연결
        # 두 개의 개행은 청크 간 구분을 명확히 하기 위함
        return "\n\n".join([doc.page_content for doc in docs])
