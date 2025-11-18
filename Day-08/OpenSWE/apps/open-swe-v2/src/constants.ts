/**
 * @file constants.ts
 * @description 이 파일은 애플리케이션 전반에서 사용되는 핵심 상수들을 정의하고 내보냅니다.
 * 특히, 'Human-in-the-Loop' 사용자 승인 메커니즘의 정책을 결정하는 명령어 이름 세트를
 * 중앙에서 관리합니다. 이 상수들을 통해 어떤 명령어가 민감한 작업으로 간주되어
 * 실행 전 사용자 확인을 받아야 하는지 명확하게 정의하고, 일관성 있게 적용할 수 있습니다.
 */

/**
 * 아래 상수들은 `post-model-hook.ts`의 사용자 승인 시스템에서 핵심적인 역할을 합니다.
 * 모델이 도구 사용을 제안했을 때, 해당 도구의 이름이 이 세트(Set)에 포함되어 있는지 확인하여
 * 승인 절차를 트리거할지 여부를 결정합니다.
 */

/**
 * 파일 내용을 직접적으로 수정하는 명령어 이름들의 세트입니다.
 * 이 명령어들은 `WRITE_COMMANDS`의 하위 집합으로, `state.ts`에서 승인 키를 생성할 때
 * 파일 경로 기반의 디렉토리를 식별하는 데 사용됩니다.
 * - `write_file`: 파일 전체를 덮어씁니다.
 * - `str_replace_based_edit_tool`: 파일 내 문자열을 찾아 교체합니다.
 * - `edit_file`: 파일 내용을 수정합니다.
 */
export const FILE_EDIT_COMMANDS = new Set([
  "write_file",
  "str_replace_based_edit_tool",
  "edit_file",
]);

/**
 * 실행 전 사용자에게 명시적인 승인을 받아야 하는 모든 명령어 이름들의 세트입니다.
 * 이 목록에는 파일 시스템을 변경하거나, 임의의 코드를 실행하거나, 잠재적으로 민감한 정보를
 * 노출할 수 있는 모든 명령어가 포함됩니다. 'fail-safe' 원칙에 따라, 조금이라도 위험의
 * 소지가 있는 작업은 이 목록에 추가하여 사용자 통제 하에 두는 것을 목표로 합니다.
 * - `execute_bash`: 가장 위험도가 높은 명령어로, 임의의 셸 코드를 실행할 수 있습니다.
 * - `ls`, `glob`, `grep`: 파일 시스템 구조나 내용을 탐색하며, 의도치 않은 정보 노출을
 *   막기 위해 사용자의 확인을 받습니다.
 */
export const WRITE_COMMANDS = new Set([
  "write_file",
  "execute_bash",
  "str_replace_based_edit_tool",
  "ls",
  "edit_file",
  "glob",
  "grep",
]);
