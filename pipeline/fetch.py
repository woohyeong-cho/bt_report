"""KOSPI·KOSDAQ 전 종목 일봉(수정주가) 수집 → data/prices.parquet

FinanceDataReader 사용 (로그인 불필요). 상장폐지 종목은 포함되지 않는다.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import FinanceDataReader as fdr
import pandas as pd
import requests

# FDR은 timeout 없이 requests.get을 호출해서 응답이 없으면 무한정 멈춘다 → 기본 timeout 강제
_request = requests.Session.request


def _request_with_timeout(self, *args, **kwargs):
    kwargs.setdefault("timeout", 15)
    return _request(self, *args, **kwargs)


requests.Session.request = _request_with_timeout

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
START = "2015-01-01"  # 2016년부터 52주 신고가를 계산하려면 1년 앞서 받아야 함
MARKETS = ["KOSPI", "KOSDAQ", "KOSDAQ GLOBAL"]


def load_universe() -> pd.DataFrame:
    listing = fdr.StockListing("KRX")
    u = listing[listing.Market.isin(MARKETS)].copy()
    u = u[u.Code.str[-1] == "0"]  # 우선주 제외
    u = u[~u.Name.str.contains("스팩")]  # 스팩 제외
    u["Market"] = u.Market.replace({"KOSDAQ GLOBAL": "KOSDAQ"})
    return u[["Code", "Name", "Market", "Marcap", "Stocks"]].reset_index(drop=True)


def fetch_one(code: str, retries: int = 3) -> pd.DataFrame | None:
    for i in range(retries):
        try:
            d = fdr.DataReader(code, START)
            if d.empty:
                return None
            d = d[["Open", "High", "Low", "Close", "Volume"]].copy()
            d["Code"] = code
            time.sleep(0.05)
            return d
        except Exception:
            time.sleep(2 + i * 3)
    return None


def main() -> None:
    DATA.mkdir(exist_ok=True)
    uni = load_universe()
    uni.to_parquet(DATA / "universe.parquet")
    print(f"universe: {len(uni)} stocks", flush=True)

    frames, failed = [], []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(fetch_one, c): c for c in uni.Code}
        for n, f in enumerate(as_completed(futs), 1):
            d = f.result()
            if d is None:
                failed.append(futs[f])
            else:
                frames.append(d)
            if n % 250 == 0:
                print(f"  {n}/{len(uni)} ({time.time() - t0:.0f}s)", flush=True)

    prices = pd.concat(frames).reset_index().rename(columns={"index": "Date"})
    prices["Date"] = pd.to_datetime(prices["Date"])
    for c in ["Open", "High", "Low", "Close"]:
        prices[c] = prices[c].astype("float32")
    prices["Volume"] = prices["Volume"].astype("int64")
    prices.to_parquet(DATA / "prices.parquet", index=False)

    idx = []
    for sym, name in [("NAVER:KOSPI", "KOSPI"), ("NAVER:KOSDAQ", "KOSDAQ")]:  # KS11은 갱신이 며칠 늦음
        d = fdr.DataReader(sym, START)[["Close"]].rename(columns={"Close": name})
        idx.append(d)
    pd.concat(idx, axis=1).rename_axis("Date").to_parquet(DATA / "index.parquet")

    print(f"done: {len(frames)} ok, {len(failed)} failed, {len(prices):,} rows, "
          f"last={prices.Date.max().date()} ({time.time() - t0:.0f}s)")
    if len(failed) > len(uni) * 0.05:
        sys.exit(f"too many failures: {failed[:20]}")


if __name__ == "__main__":
    main()
