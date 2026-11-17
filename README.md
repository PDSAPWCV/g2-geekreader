# GeekReader KR

Even Realities G2로 [GeekNews](https://news.hada.io) 글의 제목과 한글 요약을 읽는 비공식 리더 (Even Hub 플러그인)

- 한 화면에 글 하나(제목 + 요약 앞부분)를 보여주고, 쓸어서 다음 글로 넘깁니다.
- 탭하면 그 글의 요약을 끝까지 읽습니다.
- 길게 누르면 "나중에 읽기"로 저장되고, 폰 화면에서 긱뉴스 글 페이지로 엽니다.
- 읽은 글은 기억해 두었다가 다음에 열 때 안 읽은 글부터 보여줍니다.

## 조작

| | 훑어보기 | 요약 읽기 |
|---|---|---|
| 쓸기 | 다음 / 이전 글 | 다음 / 이전 쪽. 마지막 쪽에서 한 번 더 쓸면 다음 글 |
| 탭 | 요약 읽기 | 다음 글 |
| 두 번 탭 | 앱 종료 | 훑어보기로 돌아가기 |
| 길게 누르기 | 저장 / 저장 취소 | 저장 / 저장 취소 |

맨 끝 화면에서 탭하면 새 글을 확인합니다. 조작 규칙은 `src/reader.ts` 한 곳에 있습니다.

## 읽는 데이터와 한계

이 앱은 긱뉴스가 공개한 피드(`https://news.hada.io/rss/news`)만 읽습니다.

- 피드에는 글마다 제목과 요약의 앞 300자 정도만 들어 있습니다. 요약 전체, 상세 본문, 댓글은 글 페이지에만 있어서 이 앱에는 나오지 않습니다.
- 피드는 최신 20개만 담습니다. 중계 서버가 30분마다 피드를 읽어 150개까지 모아 둡니다.

## 요구 사항

- Node.js 20.19 이상 또는 22.13 이상 (Vite 8과 evenhub-cli 기준)
- Even 앱 2.2.10 이상 (SDK `@evenrealities/even_hub_sdk` 0.0.16 기준)

```bash
npm install
```

설치 뒤 `evenhub-simulator` 명령을 찾지 못하면 아래로 실행 파일을 다시 연결합니다.

```bash
npm rebuild @evenrealities/evenhub-simulator
```

## PC에서 실행

```bash
npm run dev
```

http://localhost:5175 을 열면 폰 화면이 나옵니다. "안경 화면" 미리보기 아래의 버튼으로 안경 조작을 흉내 낼 수 있어
시뮬레이터 없이도 흐름을 볼 수 있습니다. 개발 서버에 피드 중계가 들어 있어(`vite.config.ts`, 10분에 한 번만 피드를 읽음)
Worker 없이 실제 글이 나옵니다.

```bash
npm run simulator
```

Even Hub 시뮬레이터로 같은 주소를 엽니다.

### 개발용 URL 파라미터

- `?mock=1`: 데모 모드. 네트워크 없이 지어낸 글로 화면과 조작을 확인합니다.
- `?feed=<URL>`: 피드 서버 주소 덮어쓰기.
- `?reset=1`: 설정·읽음·저장 목록·받아 둔 글을 지우고 시작합니다. 주소에 붙어 있는 동안 열 때마다 지웁니다.
- `?debug=1`: 안경에 그린 내용을 콘솔에 남기고, 개발 서버의 주소 이동 명령(`/__dev/goto`)을 따릅니다.
- `?ctl=<URL>`: 빌드본이 따를 개발 서버 주소(`?debug=1`과 함께).

피드 서버 주소 우선순위: `?feed=` > 폰 화면 "개발용" 칸 > `VITE_FEED_BASE` > 개발 서버의 `/api`.

## 점검

```bash
npm test
```

피드 파싱, 조작 규칙, 화면 줄 나누기를 확인합니다. 네트워크를 쓰지 않습니다.

```bash
npm run build
```

타입 검사 뒤 `dist/`를 만듭니다. 패키지(.ehpk)는 `npm run pack`으로 만듭니다.

## 시뮬레이터 자동 검증

`scripts/sim-verify.ts`가 시뮬레이터 창 하나에 터치 입력을 보내며 단계마다 화면을 검사합니다. 앱이 그린 7줄이
기대한 화면인지, 그리고 스크린샷에서 잰 줄 폭이 `src/text.ts`의 예측과 맞는지(넘치면 줄이 잘림)를 봅니다.

| 구간 | 내용 |
|---|---|
| A. 데모 모드 | 조작 규칙 전부 (글·쪽 넘기기, 탭·두 번 탭·길게 누르기, 연속 입력 제한, 끝 화면, 읽음 유지) |
| B. 실제 피드 | 받아 온 모든 글의 카드와 요약 쪽, 새 글 확인, 피드 서버에 닿지 않을 때의 안내 |
| C. 빌드본 + Worker | 빌드본을 Worker에 연결해 표시·조작·종료 |
| D. 마무리 | 종료 뒤 개발 화면으로 돌아와 다시 그려지는지 |

개발 서버와 자동화 API(포트 9898)를 켠 시뮬레이터를 띄운 뒤 실행합니다(약 3분, A·B·D 구간).

```bash
npm run simulator:auto
```

```bash
npm run verify:sim
```

C 구간까지 돌리려면 `npm run build` 후 `npm run preview`(포트 4173)도 띄우고, 아래 중 하나를 실행합니다.

- `npm run verify:sim:deployed`: 빌드본에 들어 있는 Worker 주소(`.env.production.local`)를 씁니다.
- `npm run verify:sim:full`: 로컬 Worker(`npm --prefix worker run dev`, 포트 8790)를 씁니다.

결과는 `.verify/report.txt`와 단계별 스크린샷으로 남습니다.

## 피드 중계 Worker (`worker/`)

피드에 CORS 헤더가 없어 앱(WebView)이 직접 읽을 수 없으므로 Cloudflare Worker가 중계합니다. Worker는 피드만
읽고(30분마다) KV에 모아 `GET /items`로 내줍니다.

직접 배포하려면 `worker/`에서:

1. `npx wrangler login`
2. `npx wrangler kv namespace create FEED` → `wrangler.jsonc`를 `wrangler.local.jsonc`로 복사하고
   출력된 ID를 그 파일의 `id`에 넣기
3. `npm run deploy` → 출력된 `https://geekreader-kr.<서브도메인>.workers.dev` 주소를
   저장소 루트의 `.env.production.local`에 `VITE_FEED_BASE=<주소>`로 넣기

`wrangler.local.jsonc`와 `.env.production.local`은 git에 올라가지 않습니다. `npm run pack`이 이 주소로
`app.json`의 network whitelist를 채워 패키지를 만듭니다.

## 구조

```
app.json              Even Hub 매니페스트
index.html            폰 화면
vite.config.ts        개발 서버: 피드 중계(/api), 시뮬레이터 검증용 주소 이동(/__dev)
shared/feed.ts        피드(Atom) → 글 목록. Worker·개발 서버·테스트가 같이 씀

src/main.ts           진입점: 폰 화면 렌더링 + 컨트롤러 시작
src/controller.ts     안경 쪽 흐름: 무엇을 보여줄지, 입력 걸러내기, 수명주기
src/lens.ts           안경 화면 그리기: 입력 받는 컨테이너 + 7줄, 바뀐 줄만 갱신
src/reader.ts         조작 규칙 (순수 상태 기계)
src/gestures.ts       입력 이벤트 → 제스처
src/layout.ts         화면 줄 구성: 카드, 요약 쪽 나누기, 안내 화면, 글자 밝기
src/text.ts           픽셀 폭 표, 줄 자르기/감싸기
src/feed.ts           중계 서버 호출, 로컬 캐시, 상태
src/store.ts          설정·읽음·저장 목록 (localStorage + bridge KVS 미러)
src/bridge.ts         Even 앱 브리지를 한 번만 받아 공유
src/log.ts            폰 화면 로그 (콘솔 출력도 함께 모음)
src/mock.ts           데모 모드 데이터
src/params.ts         개발용 URL 파라미터
src/types.ts          공통 타입

worker/               피드 중계 (Cloudflare Worker + KV + cron)
test/                 단위 테스트
scripts/sim-verify.ts 시뮬레이터 자동 검증 (png.ts는 스크린샷 판독)
scripts/pack.ts       패키지(.ehpk) 만들기: app.json whitelist에 Worker 주소 채우기
```

not verified on hardware

## 라이선스

[MIT](LICENSE)
