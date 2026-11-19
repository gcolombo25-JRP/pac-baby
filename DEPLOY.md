# 🚀 배포 가이드 (무료)

Pac-Baby 는 **100% 정적 사이트**입니다(서버·DB 없음). 그래서 **GitHub Pages / Vercel / Netlify** 어디에나 무료로 올릴 수 있고,
지인에게 URL만 보내면 휴대폰 브라우저에서 바로 플레이할 수 있습니다.

- 빌드: `npm run build` → `dist/` (index.html + assets/*.js + assets/*.css)
- `vite.config.js` 에 **`base: './'`** 설정이 있어 **하위 경로**(예: GitHub Pages `/<repo>/`)에서도 에셋이 정상 로드됩니다.
- 테스터 모드는 배포본에도 포함되며, URL 뒤에 **`?test=1`** 로 열 수 있습니다(일반 플레이에는 영향 없음).

---

## A. GitHub Pages (자동 배포) — 추천

**대상 저장소**: <https://github.com/gcolombo25-JRP/pac-baby> (Public)
**배포 주소**: <https://gcolombo25-jrp.github.io/pac-baby/>

**현재 진행 상태**

- [x] 로컬 git 저장소 초기화 + 커밋 완료 (39개 파일, `node_modules`/`dist` 제외)
- [x] `origin` 원격 연결 완료 (`https://github.com/gcolombo25-JRP/pac-baby.git`, 브랜치 `main`)
- [x] **push 완료** — `main` = `48a26a6` (워크플로우 실행 #2 성공)
- [x] **Pages 활성화 완료** (`build_type: workflow`) → **배포 성공**
- ✅ **라이브 사이트**: <https://gcolombo25-jrp.github.io/pac-baby/>

**배포 검증(2026-11-19 기준)**

| 항목 | 결과 |
|---|---|
| `GET /pac-baby/` | **200** (1,387 B, `Server: GitHub.com`) |
| `./assets/index-*.js` | **200** (44,082 B) |
| `./assets/index-*.css` | **200** (1,652 B) |
| 없는 에셋 | **404** |
| `?test=1` | **200** |
| Actions `Deploy to GitHub Pages` | **success** |

### 1) 저장소 확인
- <https://github.com/gcolombo25-JRP/pac-baby> — 이미 생성되어 있고 **비어 있는 상태**(커밋 0개)입니다.
- 기본 브랜치: **`main`** · Public 저장소라 무료 Pages 사용 가능

### 2) 업로드 (push)
이미 push 되어 있으므로, **코드를 수정한 뒤**에는 아래 방법으로 다시 올리면 됩니다(올릴 때마다 자동 재배포).

```
[1/3] 저장소 준비 (init · 사용자 · origin 자동) → [2/3] 변경사항 커밋 → [3/3] push
```

터미널에서 직접 하려면 (이 PC 의 git 은 PATH 에 없으므로 전체 경로 사용):
```powershell
cd d:/DVSProject/PacBaby
& 'C:\Program Files\Git\bin\git.exe' push -u origin main
```

> 최초 push 때 **Git Credential Manager 로그인 창**이 뜹니다. GitHub 계정으로 승인하면 이후 push 부터는 자동입니다.
> (2단계 인증 사용 시 비밀번호 대신 **Personal Access Token**(`repo` 권한)을 입력)
> 💡 이 PC 의 git 은 **PATH 에 없고** `C:\Program Files\Git\bin\git.exe` 에만 있습니다.  
> `push.bat` 이 표준 경로에서 자동 탐색하며, VS Code 소스 제어는 `.vscode/settings.json` 의 `git.path` 를 사용합니다.  
> git 을 PATH 에 추가하려면: `[Environment]::SetEnvironmentVariable('Path', $env:Path + ';C:\Program Files\Git\bin', 'User')` 실행 후 터미널 재시작.

### 3) Pages 소스 설정 (최초 1회, 중요)
저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**

> Pages 는 이미 **활성화**되어 있습니다(`build_type: workflow`). 새 저장소나 포크에서 처음 배포할 때만
> 이 설정을 먼저 켜면 됩니다. (`configure-pages` 의 `enablement: true` 는 `GITHUB_TOKEN` 권한이 충분할 때만 자동 활성화됩니다.)

### 4) 자동 배포
`.github/workflows/deploy.yml` 이 `main`/`master` push 시 자동으로:
```
npm ci → npm test → npm run build → Pages 업로드 → 배포
```
진행 상황은 저장소 **Actions 탭 → Deploy to GitHub Pages** 에서 확인할 수 있습니다.
수동 재배포는 **Actions → Deploy to GitHub Pages → Run workflow** 로 실행하세요.

### 5) 주소 확인
- **<https://gcolombo25-jrp.github.io/pac-baby/>**
- 또는 Actions 실행 화면의 `deploy` 잡에 표시되는 **page_url**

> ⚠️ 무료 계정에서 Pages 는 **Public 저장소**에서 사용할 수 있습니다(Private 은 유료 플랜 필요).
> 커스텀 도메인은 **Settings → Pages → Custom domain** 에서 설정합니다.

---

## B. Vercel (Git 연동 또는 CLI)

1. <https://vercel.com> → **Add New… → Project** → `gcolombo25-JRP/pac-baby` Import
2. 설정은 자동 감지됩니다(Vite)
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. **Deploy** → `https://<project>.vercel.app`

CLI 로 하려면:
```bash
npm i -g vercel
vercel --prod
```
서버·환경변수가 필요 없고, `base: './'` 설정 그대로 루트 도메인에서 동작합니다.

---

## C. 지인에게 공유하기 (휴대폰)

- 배포된 **URL만 전달**하면 됩니다.
  - GitHub Pages: **<https://gcolombo25-jrp.github.io/pac-baby/>**
  - Vercel: `https://<project>.vercel.app/`
- 휴대폰에서는 **D-패드(▲◀▶▼ + 울기/소리/정지)** 가 자동 표시됩니다.
- **소리/BGM**은 브라우저 정책상 **첫 터치(또는 키 입력) 이후** 재생됩니다. `M` 으로 on/off.
- 하이스코어(HI-SCORE)는 **localStorage** 에 저장되며 도메인별로 분리됩니다.
- 테스터 패널이 필요하면 URL 뒤에 **`?test=1`** 을 붙이세요.
- 업데이트 직후 예전 화면이 보이면 **새로고침**(데스크톱 `Ctrl+Shift+R`) 하세요.

### 카카오톡 인앱 브라우저 캐시 대응
- `vite.config.js` 가 모든 JS/CSS/청크에 **콘텐츠 해시 파일명**(`assets/index-<hash>.js`)을 붙이고
  `assetsInlineLimit: 0` 으로 항상 별도 파일로 방출합니다.
- 빌드 시 생성되는 **`dist/version.json`** 을 `index.html` 이 `cache: 'no-store'` 로 확인하고,
  이전에 본 빌드와 다르면 `?v=<빌드ID>` 쿼리로 **자동 새로고침**합니다.
- `dist/index.html` 에는 `Cache-Control: no-store` 메타 태그가 포함됩니다.
- 이 기능이 배포되기 **이전 버전을 캐시한 사용자**는 최초 1회만 강력 새로고침이 필요할 수 있습니다.

---

## D. 배포 전 체크리스트

- [ ] `npm test` — 171개 통과
- [ ] `npm run build` — `dist/index.html` 의 스크립트/스타일 경로가 **`./assets/index-<hash>...`** 인지 확인
- [ ] `dist/version.json` 생성 확인 (카카오톡 캐시 우회용)
- [ ] `npm run preview` 로 빌드본 동작 확인 (개발 서버와 별개)
- [ ] 침대 스텔스 · 울기(쿨다운/무해/연장) · 트랩 얼림 · 목숨/게임오버 · 라운드 클리어 확인
- [ ] BGM/효과음(첫 터치 후) · 모바일 D-패드 확인
- [ ] `?test=1` 로 테스터 모드 확인

---

## E. 문제 해결

| 증상 | 확인 |
|---|---|
| 사이트가 **404** | Pages Source 가 **GitHub Actions** 인지, 첫 배포가 완료됐는지 |
| Actions 실행이 **job 0개로 실패** | 워크플로우 **YAML 문법 오류**. 예: `- name: Build (base: ./ …)` 처럼 따옴표 없는 스칼라에 `콜론+공백`이 들어가면 파싱 실패 → 이름에서 콜론 제거 또는 따옴표로 감싸기 |
| `Configure Pages` 단계만 실패 | Pages 가 비활성(`has_pages: false`) 상태 → **Settings → Pages → Source: GitHub Actions** 로 한 번 켠 뒤 **Re-run** |
| 흰 화면 + 콘솔에 `assets/... 404` | `vite.config.js` 의 `base: './'` 유지, `dist` 루트에 `index.html` 존재 여부 |
| Actions 실패 | `npm ci` 로그 확인, `package-lock.json` 커밋 여부, Node 20 사용 |
| 소리가 안 남 | 첫 터치/키 입력 이후인지, 기기 무음 모드/볼륨, `M` 토글 상태 |
| 하이스코어가 초기화됨 | 도메인이 바뀌면 저장소가 분리됨(정상). `?reset-hi=1` 로 수동 초기화도 가능 |
| 모바일에서 패드가 안 보임 | 터치 기기이거나 화면 폭 700px 이하일 때만 표시 |
