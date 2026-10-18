# LOOM

**한국어** · [English](README.en.md)

> **단어를 엮어, 이미지를 짓다.**  
> Weave the Words. Build the Image.

LOOM은 프롬프트를 이루는 단어와 요소를 한 올씩 엮어, 완성된 프롬프트 한 장으로 짜내는 ComfyUI용 프롬프트 빌더입니다.
주제 · 스타일 · 조명 · 구도 같은 요소를 블록처럼 조합하고 템플릿으로 관리해, 원하는 이미지를 반복해서 만들 수 있게 합니다.

- **WARP (날실)**: 구조와 템플릿. 베틀에 먼저 거는 세로 실처럼 프롬프트의 뼈대를 잡습니다
- **WEFT (씨실)**: 요소와 표현. 날실 사이를 오가는 가로 실처럼 주제 · 스타일 · 조명 · 분위기를 엮습니다

**LOOM — Prompt Builder for ComfyUI**는 내 컴퓨터에서만 동작하는 데스크톱 앱입니다.
웹 서비스와 연동하지 않고 로그인 · 계정도 없습니다. 템플릿 · 이미지 · 생성 결과는 모두 내 컴퓨터의 저장 위치에 보관되고,
완성한 프롬프트는 같은 컴퓨터나 네트워크의 ComfyUI로 바로 보내 이미지를 만듭니다.

> 화면 글자는 한국어입니다.

## 주요 기능

- **단계별 빌더**: 템플릿 → 인물 → 의상 · 포즈 → 배경 → 카메라 · LoRA 순서로 고르면 오른쪽에 프롬프트가 바로 조합됩니다.
  조합된 프롬프트를 직접 고쳐 쓸 수도 있습니다
- **템플릿**: Positive Prompt에 넣은 `{변수}`가 빌더에서 고르는 세부 항목이 됩니다. `{이름:A|B|C}` 바로 고르기,
  Full Options 일괄 입력, 코드로 저장 · 불러오기, 스타일 분류, 썸네일
- **ComfyUI로 바로 생성** (⌘↵): API 형식 workflow에 프롬프트를 넣어 대기열로 보냅니다. 서버 최대 3개,
  크기 · CFG · Steps · LoRA 강도 조절, seed는 매번 무작위. ComfyUI가 꺼져 있으면 실패하지 않고 기다립니다
- **갤러리**: 생성 결과를 저장 위치에 보관합니다. 대기 작업을 목록으로 보고 하나씩 취소, 같은 설정으로 다시 생성,
  **빌더에서 열기**(그때의 선택값 복원), 여러 장 선택 삭제. 목록은 작은 썸네일로 빨리 그리고 크기는 50–250%로 자유롭게 조절,
  크게 볼 때는 원본을 보여 줍니다. 아래쪽 썸네일 줄에서 고르거나 ← →로 넘기고,
  마우스 휠로 확대 · 축소합니다(배율 %와 실제 크기 표시, 끌어서 옮기기). 이미지를 지우면 썸네일도 함께 지웁니다
- **프롬프트 요소 관리**: 빌더에서 고르는 인물 · 메이크업 · 헤어 · 의상 · 포즈 · 악세사리 · 타투 · 카메라 · 렌더링 항목을
  종류 · 그룹별로 보고 바로 등록 · 수정 · 삭제 (사용 끄기로 숨기기, 전체 검색)
- **데이터는 따로 배포**: 앱(이 저장소)에는 데이터가 없고 빈 상태로 시작합니다. 템플릿 · 프롬프트 요소 · 의상 프리셋 ·
  유명 배경 · workflow 묶음(zip)을 따로 받아 데이터 메뉴에서 가져옵니다 ([데이터 넣기](#데이터-넣기))
- **데이터 관리**: 템플릿 · 프롬프트 요소 · 의상 프리셋 · 유명 배경을 종류별로 내보내기 · 가져오기 · 비우기
  (템플릿은 스타일을, 프롬프트 요소는 종류를 골라 그것만 옮길 수 있음),
  DB 백업 · 복원, 저장 위치 변경(다시 시작할 때 자동으로 옮김)

## 지원 환경

| | macOS 13 이상 (Apple Silicon) | Windows 10 · 11 (x64) |
| --- | --- | --- |
| 앱 실행 (소스로) | ✅ | ✅ |
| 독립 앱 만들기 | ✅ `LOOM.app` | — (소스로 실행) |
| 단축키 | ⌘ | Ctrl (사용법은 F1) |
| 파일 위치 보기 | Finder | 파일 탐색기 |

- Intel Mac은 같은 방법으로 설치할 수 있지만 확인하지 않았습니다. Linux는 지원하지 않습니다.
- Windows는 GitHub Actions의 Windows 서버에서 아래 순서대로 설치해 `tools/smoke_test.py`로 확인합니다.
- [Python](https://www.python.org) 3.12가 필요합니다 (macOS는 Homebrew, Windows는 winget 권장).
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)는 따로 설치해 켜 둡니다. 같은 컴퓨터든 네트워크의 다른 컴퓨터든 됩니다.
- 기술 구성: Python 3.12 앱입니다. 창은 PySide6(Qt) · QtWebEngine, 서버는 Python 표준 라이브러리, 데이터는 SQLite이고,
  창 안의 화면만 HTML · CSS · JavaScript로 그립니다. 그 밖의 외부 패키지는 쓰지 않습니다.

## OS별 설치

### macOS

터미널에서 실행합니다. [Homebrew](https://brew.sh)가 없으면 먼저 설치하세요.

```bash
# 1. 준비
brew install python@3.12 gh
gh auth login                  # 비공개 저장소라 초대받은 GitHub 계정으로 로그인합니다

# 2. 받기
gh repo clone mifplus-git/LOOM
cd LOOM

# 3. 설치
$(brew --prefix)/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt pyinstaller

# 4. 앱 만들기 → /Applications/LOOM.app
.venv/bin/python tools/build_app.py
```

- `tools/build_app.py`는 Python · PySide6 · 코드를 모두 담은 독립 앱을 만들어 `/Applications`에 설치합니다.
  만든 뒤에는 이 폴더가 없어도 실행됩니다. 만들기만 하려면 `--no-install`을 붙입니다 (결과: `build/dist/LOOM.app`).
- 앱을 만들지 않고 바로 실행할 수도 있습니다: `.venv/bin/python app.py` (앱 창), `.venv/bin/python app.py --browser` (기본 브라우저).
- 처음 실행하면 저장 위치(`~/Documents/LOOM`)에 빈 데이터 폴더를 만듭니다. 데이터는 아래 [데이터 넣기](#데이터-넣기)로 넣습니다.
- 설치 확인: `.venv/bin/python tools/smoke_test.py` (테스트용 임시 폴더로 서버와 앱 창을 띄워 봅니다. 실제 데이터는 건드리지 않습니다)

### Windows

PowerShell에서 실행합니다.

```powershell
# 1. 준비
winget install Python.Python.3.12
winget install Git.Git
winget install GitHub.cli
# 설치한 뒤 PowerShell을 새로 열어야 PATH가 반영됩니다
gh auth login                  # 비공개 저장소라 초대받은 GitHub 계정으로 로그인합니다

# 2. 받기
gh repo clone mifplus-git/LOOM
cd LOOM

# 3. 설치
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 4. 실행
.venv\Scripts\pythonw app.py
```

- `pythonw`는 콘솔 창 없이 띄웁니다. 문제가 생겨 메시지를 보려면 `.venv\Scripts\python app.py`로 실행하세요.
- **바탕 화면 바로가기**: 바탕 화면에서 오른쪽 클릭 → 새로 만들기 → 바로 가기, 항목 위치에
  `"<LOOM 폴더>\.venv\Scripts\pythonw.exe" "<LOOM 폴더>\app.py"`를 넣습니다.
- 설치 확인: `.venv\Scripts\python tools\smoke_test.py`
- 처음 실행하면 저장 위치(`문서\LOOM`)에 빈 데이터 폴더를 만듭니다. 데이터는 아래 [데이터 넣기](#데이터-넣기)로 넣습니다.
- Windows에서는 독립 앱(.exe)을 만들지 않고 소스로 실행합니다 (`tools/build_app.py`는 macOS 전용).
  메뉴 막대는 창 안에 있고, **LOOM 정보**는 **도움말** 메뉴에 있습니다.
- 아래 예시의 `.venv/bin/python`은 Windows에서 `.venv\Scripts\python`입니다.

### 데이터 넣기

저장소에는 데이터가 들어 있지 않습니다. 데이터 묶음은 따로 배포합니다.

| 파일 | 내용 | 넣는 곳 |
| --- | --- | --- |
| `loom-elements-….zip` | 프롬프트 요소 (빌더의 인물 · 의상 · 포즈 · 카메라 항목, 배경 옵션) | 데이터 → 프롬프트 요소 → 가져오기 |
| `loom-places-….zip` | 유명 배경 (미리보기 이미지 포함) | 데이터 → 유명 배경 → 가져오기 |
| `loom-templates-….zip` | 템플릿 (스타일 · 썸네일 포함) | 데이터 → 템플릿 → 가져오기 |
| `loom-outfits-….zip` | 의상 프리셋 (미리보기 이미지 포함) | 데이터 → 의상 프리셋 → 가져오기 |
| `loom-workflows-….zip` | ComfyUI workflow (API 형식 JSON) | 풀어서 JSON 파일들을 Workflow 메뉴에 끌어다 놓기 |

데이터 묶음 zip은 풀지 말고 그대로 고르세요. 가져오기 전에 지금 데이터를 자동으로 백업하고, 가져오기는 지금 데이터에 더하기만 합니다.

## ComfyUI 연결

1. ComfyUI를 켭니다. 같은 컴퓨터라면 기본 주소 `http://127.0.0.1:8188`을 그대로 씁니다.
   다른 컴퓨터의 ComfyUI는 그 컴퓨터에서 `--listen`으로 실행하고 주소(예: `http://192.168.0.10:8188`)를 넣습니다.
2. ComfyUI에서 쓰려는 workflow를 **Export (API)**로 저장합니다 (API 형식 JSON). 따로 받은 workflow 묶음을 써도 됩니다.
3. LOOM의 **Workflow** 메뉴에서 그 JSON을 추가하고 기본으로 지정합니다.
4. **ComfyUI 서버** 메뉴에서 **연결 확인**을 누릅니다.

프롬프트는 workflow의 `{{positive}}` · `{{negative}}` 자리에 들어갑니다. 자리가 없으면 제목이 ‘positive prompt’ · ‘user prompt’인
문자열 노드를, 그것도 없으면 CLIPTextEncode 노드를 찾아 넣습니다. 생성 결과는 저장 위치의 `outputs/날짜/`에 저장됩니다.

## 화면과 단축키

| 화면 | 하는 일 |
| --- | --- |
| **빌더** ⌘B | 템플릿 · 인물 · 의상 · 포즈 · 배경 · 카메라 · LoRA를 골라 프롬프트를 조합하고 ComfyUI로 생성합니다 |
| **갤러리** ⌘G | 생성 결과, 진행 · 대기 작업(하나씩 취소), 실패 기록. 다시 생성 · 빌더에서 열기 · Finder에서 보기 · 삭제 |
| **템플릿 만들기** ⌘T | 템플릿 목록(스타일 · 검색)과 편집기, 스타일 관리 |
| **프롬프트 요소** ⌘E | 빌더에서 고르는 요소를 종류 · 그룹별로 보고 바로 등록 · 수정 · 삭제 |
| **ComfyUI 서버** ⌘, | 서버 주소(최대 3개) · 연결 확인 · 결과 대기 시간 |
| **Workflow** · **LoRA** | API 형식 workflow 추가 · 기본 지정, LoRA 목록 |
| **데이터** ⌘D | 종류별 내보내기 · 가져오기 · 비우기, 백업 · 복원, 저장 위치 |
| **도움말** · **정보** | 사용법, 버전 · 브랜드 소개 · 단축키 |

Windows에서는 ⌘ 대신 Ctrl이고, 사용법은 F1입니다.

| 단축키 | 동작 |
| --- | --- |
| ⌘↵ | 생성 |
| ⌘1 – ⌘5 | 빌더 단계 이동 |
| ⌘S | 템플릿 저장 |
| ← → | 갤러리 · 피커에서 이전 · 다음 (갤러리는 Home · End로 처음 · 끝) |
| 휠 · + − | 갤러리에서 크게 볼 때 확대 · 축소 (0 화면에 맞춤, 1 실제 크기) |
| T | 갤러리에서 크게 볼 때 아래쪽 썸네일 줄 보기 · 숨기기 |
| ⌘? | 사용법 |
| ⌘+ · ⌘− · ⌘0 | 화면 크게 · 작게 · 원래 크기 |

메뉴 막대의 **도움말**에서 사용법과 웹사이트 · 홈페이지 · 블로그 · GitHub로 바로 갈 수 있고,
**LOOM 정보**(macOS는 LOOM 메뉴, Windows는 도움말 메뉴)에서 버전과 브랜드 소개를 봅니다.

## 데이터 위치

| 무엇 | macOS | Windows |
| --- | --- | --- |
| 저장 위치 (DB · 이미지 · workflow · 생성 결과 · 백업) | `~/Documents/LOOM` | `문서\LOOM` |
| 앱 설정 (저장 위치 기록 · 창 저장소) | `~/Library/Application Support/LOOM` | `%LOCALAPPDATA%\LOOM` |
| 기록 (로그) | `~/Library/Logs/LOOM.log` | `%LOCALAPPDATA%\LOOM\LOOM.log` |

```
저장 위치 (예: ~/Documents/LOOM)
  pb.sqlite3      DB (템플릿 · 요소 · 의상/배경 프리셋 · LoRA · 스타일 · 생성 기록)
  media/          프리셋 · 템플릿 이미지
  workflows/      ComfyUI API workflow JSON
  outputs/날짜/   생성 결과 이미지
  backups/        DB 백업
```

- 저장 위치는 **데이터 → 위치 변경…**으로 바꿉니다. 앱을 다시 시작할 때 데이터가 자동으로 옮겨집니다.
- 예전 이름(Prompt Builder, 1.3까지, macOS)을 쓰던 컴퓨터는 LOOM을 처음 열 때 앱 설정 · 기록 · 기본 저장 위치
  (`~/Documents/Prompt Builder`)가 자동으로 새 이름으로 바뀝니다. 예전 앱이 켜져 있으면 먼저 종료하라고 알립니다.

## 업데이트 · 삭제

```bash
cd LOOM
git pull
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/build_app.py      # macOS: LOOM을 종료(⌘Q)한 뒤 앱을 다시 만듭니다
```

Windows는 LOOM을 닫고 `git pull`, `.venv\Scripts\pip install -r requirements.txt` 뒤 다시 실행하면 됩니다.
데이터는 앱 밖의 저장 위치에 있으므로 업데이트해도 그대로입니다.

삭제: macOS는 `/Applications/LOOM.app`을 휴지통으로, Windows는 LOOM 폴더와 바로 가기를 지웁니다.
데이터까지 지우려면 위 표의 폴더도 지웁니다.

## 개발

```bash
.venv/bin/python app.py --server --port=47990 --data-dir=/tmp/loomtest   # 서버만, 테스트용 데이터로
.venv/bin/python tools/mock_comfy.py      # 가짜 ComfyUI(8188): GPU 없이 생성 흐름 확인
.venv/bin/python tools/shot.py URL out.png   # 화면 캡처 점검 (앱과 같은 QtWebEngine)
```

- 한 번에 하나만 실행됩니다 (생성 대기열을 두 번 처리하지 않도록). `--data-dir`로 띄운 점검용 실행은
  실제 저장 위치 · 설정 · 기록 파일을 건드리지 않고 실행 중인 앱과 함께 띄울 수 있습니다.
- OS별 차이(설정 · 기록 위치, 실행 잠금, 알림 창, 파일 위치 보기)는 `pb/native.py` 한 곳에 있습니다.
  화면의 단축키 · 파일 관리자 표기는 `static/js/core.js`의 `PB.mod` · `PB.fileManager`가 OS에 맞춥니다.
- `--browser`로 띄웠을 때의 파일 고르기 대화상자는 macOS에서만 됩니다 (Windows는 앱 창으로 쓰세요).
- `tools/smoke_test.py`: 어느 OS에서나 설치를 확인합니다. GitHub의 **Actions → 설치 확인**은 Windows에서 이것을 돌립니다.
- 브랜드 문구 · 링크는 `pb/brand.py` 한 곳에 있습니다 (메뉴 · LOOM 정보 창 · 정보 화면이 함께 씁니다).
- **데이터 묶음**(`pb/datapack.py`): 종류마다 zip 하나로, `pb-data.json`(format `prompt-builder-data`, version 1, 행 데이터)과
  `media/<폴더>/<파일>`이 들어 있습니다. 형식 이름은 예전 이름 그대로라 이전에 만든 묶음도 가져올 수 있습니다.
  가져오기는 더하기만 하고(같은 템플릿 제목은 `제목 (1)`, 같은 항목은 건너뜀), 비우기는 이미지 폴더를 휴지통으로 보냅니다.
  템플릿은 스타일을 골라 내보내고(`/api/data/export`의 `styles`: 스타일 id), 가져올 때도 파일을 먼저 열어 본 뒤
  (`/api/data/inspect`) 고른 스타일만 가져옵니다(`/api/data/import`의 `styles`: 스타일 이름).
  프롬프트 요소는 같은 방식으로 종류를 고릅니다(`types`: `person` · `makeup` · … · `place_slots`).
- 저장소에는 데이터를 넣지 않습니다 (`*.zip`, `seed/`는 `.gitignore`). 데이터 묶음은 데이터 메뉴의 내보내기로 만들어 따로 배포합니다.

## 폴더 구조

```
app.py            실행기: 저장 위치 확정 → 중복 실행 방지 → Qt 창 / 브라우저 / --server
pb/
  paths.py        경로 (프로그램 파일은 앱 안, 데이터는 저장 위치)
  native.py       OS별 차이 (macOS · Windows)
  storage.py      저장 위치 설정 · 이동 예약 · 예전 이름에서 옮겨 오기
  brand.py        브랜드 문구 · 링크          about.py   'LOOM 정보' 창
  server.py       표준 라이브러리 HTTP 서버 + API
  pages.py        페이지 골격과 부트 데이터 (화면은 JS가 그림)
  repo.py         DB 조회 · 저장 (빌더 요소, 프롬프트 요소 관리, 템플릿, 프리셋, LoRA, 스타일)
  datapack.py     종류별 데이터 묶음 내보내기 · 가져오기 · 비우기
  comfy.py        workflow 관리, 실행용 workflow 조립, 생성 대기열 처리기
  thumbs.py       생성 이미지 썸네일 (갤러리 · 최근 결과용, outputs/.thumbs)
  db.py           SQLite 스키마 · 연결
  settings.py · state.py · host.py · ui.py · icon.py
static/           css (app.css 디자인 시스템, pages.css 화면별) · js · img
tools/            build_app.py (macOS 앱), smoke_test.py (설치 확인), shot.py, mock_comfy.py
```

## License
This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE) file for details.
