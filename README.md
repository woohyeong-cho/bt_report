# bt_report

코스피·코스닥 52주 신고가 폭과 주도주군(자동 군집)을 매일 계산해 보여주는 대시보드.

- 사이트: https://woohyeong-cho.github.io/bt_report/
- 판단 로직 메모: [spec.md](spec.md)

## 구조

| 경로 | 내용 |
|---|---|
| `pipeline/fetch.py` | 전 종목 일봉(수정주가) 수집 → `data/` (git 제외) |
| `pipeline/analyze.py` | 신고가 · 주도주군 · 주도주 계산 → `docs/data/*.json` |
| `docs/` | GitHub Pages 정적 사이트 |
| `.github/workflows/daily.yml` | 평일 06:30 KST 자동 실행 후 커밋 |

## 로컬 실행

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python pipeline/fetch.py      # 약 2분
.venv/bin/python pipeline/analyze.py
python3 -m http.server -d docs 8765     # http://localhost:8765
```
