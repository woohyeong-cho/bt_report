# bt_report

코스피·코스닥 52주 신고가 폭과 주도주군(테마)을 매일 계산해 GitHub Pages로 보여주는 대시보드.
사이트: https://woohyeong-cho.github.io/bt_report/ · 판단 로직 메모: `spec.md` (사용자가 직접 계속 추가함, 임의로 고치지 말 것)

## 구조

- `pipeline/fetch.py`: 전 종목 10년 일봉 수집 → `data/*.parquet` (git 제외, 매번 전체 덮어쓰기)
- `pipeline/analyze.py`: 신고가 · 주도주군 · 테마 흐름 계산 → `docs/data/*.json` (git 포함)
- `docs/`: 정적 사이트 (index.html, app.js, style.css, ECharts CDN). 빌드 과정 없음
- `.github/workflows/daily.yml`: 평일 06:30 KST 실행 → fetch → analyze → 기준일(last_date)이 바뀌었을 때만 `docs/data` 커밋. 수동 실행: `gh workflow run daily-report`

## 실행

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python pipeline/fetch.py      # 로컬 약 2분, Actions 약 12분
.venv/bin/python pipeline/analyze.py    # 약 10초
python3 -m http.server -d docs 8765
```

클라우드 세션에서 네이버 접속이 막혀 fetch가 안 되면, 코드만 고쳐 push하고 `gh workflow run daily-report`로 Actions에서 데이터를 만든다.

## 정의 (analyze.py 상단 상수)

- 신고가: 종가 > 직전 250거래일 최고 종가 (`NH_LOOKBACK=250`). 화면의 "60일 신고가 N회"는 최근 60거래일 동안 52주 신고가를 낸 횟수
- 주도주군: 매월 말 + 최신일마다, 최근 20거래일 내 신고가 1회 이상 & 20일 평균 거래대금 ≥ 10억 종목을 대상으로 120일 초과수익률(종목 − 전 종목 중앙값) 상관으로 계층 군집(average linkage, 평균 상관 ≥ 0.30, 3종목 이상)
- 테마 흐름(thread): 인접(최대 2개월 간격) 군집을 구성 종목 overlap coefficient ≥ 0.30으로 연결. 이름은 가장 자주 주도한 종목 2개로 자동 생성
- 주도주 순위: 군집 내 60일 수익률 40% · 60일 신고가 횟수 30% · 거래대금 30% 순위 합
- 색: 국내 관례로 상승/신고가 = 빨강, 하락/신저가 = 파랑

## 데이터 소스 주의점 (겪은 문제)

- FinanceDataReader(네이버) 사용. pykrx는 이제 KRX 로그인(KRX_ID/KRX_PW)이 필요해서 쓰지 않음. 로그인 정보는 채팅에 받지 말 것
- FDR은 timeout 없이 requests.get을 호출해 무한 대기함 → fetch.py가 requests.Session.request에 timeout 15초를 강제함. 지우지 말 것
- 지수 `KS11`/`KQ11`은 갱신이 며칠 늦음 → `NAVER:KOSPI`/`NAVER:KOSDAQ` 사용
- `StockListing("KRX")`의 시세는 네이버 일봉 종가와 약 20%만 일치 → 증분 적재용으로 쓰면 안 됨 (종목 목록 용도로만)
- 상장폐지 종목이 없음(생존 편향) → 과거 신고가 수가 다소 적게 잡힘. 사이트에 명시돼 있음
- 맥과 리눅스에서 군집 결과가 동률 순서 정도로 미세하게 다를 수 있음 (그래서 워크플로우는 파일 diff가 아니라 last_date로 커밋 여부를 판단)

## 사용자 결정 사항

- 테마 기준: 업종/네이버 테마가 아니라 주가 동조화 자동 군집
- 시장: 코스피 + 코스닥 (보통주, 우선주·스팩 제외)
- 공개: 공개 저장소 + 공개 Pages, `noindex`. 알림 채널은 당분간 없음(URL만)

## 답을 기다리는 질문

1. "52주 고점 대비"가 마이너스인 종목 처리: (1) 마지막 신고가 날짜 열 추가 + 고점 대비 −15% 초과 하락 종목 흐리게 표시, (2) 주도주 점수에 고점 근접도 반영, (3) 편입 조건 자체를 강화. 1+2를 추천해 둔 상태
2. 처음 요청이 "최근 10년간 신고가"였음 → 52주 신고가 외에 역사적(10년) 신고가를 함께 보여줄지
3. 열 이름 "60일 신고가"를 "신고가 횟수(최근 60일)"로 바꾸기 (헷갈린다는 피드백 반영 예정)
4. 테마 이름을 사람이 붙이는 매핑 파일(선택)
