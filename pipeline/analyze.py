"""신고가 폭(breadth) · 주도주군(자동 군집) · 주도주 계산 → docs/data/*.json

정의
- 신고가: 종가가 직전 250거래일 최고 종가를 넘은 날 (250일 이력 필요)
- 주도주군: 스냅샷(매월 말 + 최신일)마다, 최근 20거래일 내 신고가를 1회 이상 낸
  유동성 종목(20일 평균 거래대금 >= 10억)을 대상으로 최근 120거래일 초과수익률
  (종목 수익률 - 전 종목 중앙값 수익률)의 상관관계로 계층 군집(average linkage)
- 테마 흐름: 인접 스냅샷의 군집을 구성 종목 겹침(overlap coefficient)으로 연결
- 주도주: 군집 내 60일 수익률 · 60일 신고가 횟수 · 20일 거래대금 순위의 가중합
"""
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data"

START = "2016-01-01"
NH_LOOKBACK = 250
WINDOW = 20           # 스냅샷 기준 신고가 탐지 기간
CORR_DAYS = 120       # 군집용 수익률 기간
MIN_VALUE = 1e9       # 20일 평균 거래대금 하한 (원)
CORR_TH = 0.30        # 군집 내 평균 초과수익 상관계수 기준
MIN_CLUSTER = 3
LINK_TH = 0.30        # 테마 흐름 연결 기준 (overlap coefficient)
MAX_MEMBERS = 30


def load():
    p = pd.read_parquet(DATA / "prices.parquet")
    uni = pd.read_parquet(DATA / "universe.parquet").set_index("Code")
    idx = pd.read_parquet(DATA / "index.parquet")
    close = p.pivot(index="Date", columns="Code", values="Close").sort_index()
    vol = p.pivot(index="Date", columns="Code", values="Volume").reindex(close.index)
    # 거래일: 전체 종목의 절반 이상이 시세를 가진 날 (지수 소스가 늦게 갱신돼도 기준일이 밀리지 않게)
    n = close.notna().sum(axis=1)
    days = close.index[n >= n.max() * 0.5]
    close, vol = close.loc[days], vol.loc[days]
    close = close.where(vol > 0)  # 거래정지일은 결측 처리
    return close, vol, uni, idx.reindex(days).ffill()


def compute(close, vol):
    prev_max = close.shift(1).rolling(NH_LOOKBACK, min_periods=NH_LOOKBACK - 10).max()
    prev_min = close.shift(1).rolling(NH_LOOKBACK, min_periods=NH_LOOKBACK - 10).min()
    nh = (close > prev_max) & prev_max.notna()
    nl = (close < prev_min) & prev_min.notna()
    active = close.notna() & prev_max.notna()
    value20 = (close * vol).rolling(WINDOW, min_periods=10).mean()
    high52 = close.rolling(NH_LOOKBACK, min_periods=60).max()
    return nh, nl, active, value20, high52


def snapshot_dates(dates: pd.DatetimeIndex) -> list[pd.Timestamp]:
    s = pd.Series(dates, index=dates)
    ends = s.groupby([dates.year, dates.month]).max().tolist()
    return [d for d in ends if d >= pd.Timestamp(START)]


def cluster_at(t, close, nh, value20, high52, logret, mkt, uni):
    i = close.index.get_loc(t)
    if i < CORR_DAYS + 60:
        return [], [], 0
    win = nh.iloc[i - WINDOW + 1 : i + 1]
    hit = win.any()
    nh_codes = hit[hit].index
    liquid = value20.iloc[i].reindex(nh_codes) >= MIN_VALUE
    cand = liquid[liquid].index

    r = logret.iloc[i - CORR_DAYS + 1 : i + 1][cand]
    r = r.loc[:, r.notna().mean() >= 0.9]
    ex = r.sub(mkt.iloc[i - CORR_DAYS + 1 : i + 1], axis=0).fillna(0.0)
    ex = ex.loc[:, ex.std() > 0]
    codes = ex.columns

    labels = np.arange(len(codes))
    if len(codes) >= 2:
        corr = np.corrcoef(ex.values.T)
        dist = np.clip(1 - corr, 0, 2)
        np.fill_diagonal(dist, 0)
        Z = linkage(squareform(dist, checks=False), method="average")
        labels = fcluster(Z, t=1 - CORR_TH, criterion="distance")

    c_now = close.iloc[i]
    ret20 = c_now / close.iloc[i - 20] - 1
    ret60 = c_now / close.iloc[i - 60] - 1
    nh60 = nh.iloc[i - 59 : i + 1].sum()
    off = c_now / high52.iloc[i] - 1

    def num(x, nd=4):
        return None if pd.isna(x) else round(float(x), nd)

    def member(code):
        return {
            "code": code,
            "name": uni.at[code, "Name"] if code in uni.index else code,
            "mkt": {"KOSPI": "코스피", "KOSDAQ": "코스닥"}.get(uni.at[code, "Market"], "") if code in uni.index else "",
            "r20": num(ret20[code]),
            "r60": num(ret60[code]),
            "nh60": int(nh60[code]),
            "val": num(value20.iloc[i][code] / 1e8, 1),  # 억원
            "off": num(off[code]),
        }

    groups = pd.Series(codes, index=labels).groupby(level=0).apply(list)
    clusters, singles = [], []
    for g in groups:
        if len(g) < MIN_CLUSTER:
            singles += g
            continue
        m = pd.DataFrame([member(c) for c in g])
        score = (0.4 * m.r60.rank(pct=True).fillna(0) + 0.3 * m.nh60.rank(pct=True)
                 + 0.3 * m.val.rank(pct=True))
        m = m.assign(score=score).sort_values("score", ascending=False)
        clusters.append({
            "size": len(g),
            "r60": num(m.r60.median()),
            "val": num(m.val.sum(), 1),
            "members": [member(c) for c in m.code.head(MAX_MEMBERS)],
            "_codes": set(g),
        })
    clusters.sort(key=lambda c: (c["size"], c["val"]), reverse=True)
    singles = sorted((member(c) for c in singles), key=lambda x: -(x["val"] or 0))[:20]
    return clusters, singles, int(len(nh_codes))


def link_threads(snaps):
    threads = []  # {id, last_k, codes, leaders Counter, points}
    for k, s in enumerate(snaps):
        used = set()
        for ci, c in enumerate(s["clusters"]):
            best, best_ov = None, LINK_TH
            for th in threads:
                if th["id"] in used or k - th["last_k"] > 2:
                    continue
                inter = len(c["_codes"] & th["codes"])
                ov = inter / min(len(c["_codes"]), len(th["codes"]))
                if ov >= best_ov:
                    best, best_ov = th, ov
            if best is None:
                best = {"id": len(threads), "leaders": Counter(), "points": []}
                threads.append(best)
            used.add(best["id"])
            best["last_k"], best["codes"] = k, c["_codes"]
            for rank, m in enumerate(c["members"][:3]):
                best["leaders"][m["name"]] += (3 - rank) * c["size"]
            best["points"].append({"k": k, "ci": ci, "size": c["size"], "val": c["val"]})
            c["thread"] = best["id"]
    out = []
    for th in threads:
        names = [n for n, _ in th["leaders"].most_common(3)]
        out.append({
            "id": th["id"],
            "label": " · ".join(names[:2]),
            "leaders": names,
            "points": th["points"],
            "weight": sum(p["size"] for p in th["points"]),
        })
    return out


def main():
    close, vol, uni, idx = load()
    nh, nl, active, value20, high52 = compute(close, vol)
    logret = np.log(close / close.shift(1))
    mkt = logret.median(axis=1)

    days = close.index[close.index >= pd.Timestamp(START)]
    breadth = {
        "dates": [d.strftime("%Y-%m-%d") for d in days],
        "kospi": idx.loc[days, "KOSPI"].round(2).tolist(),
        "kosdaq": idx.loc[days, "KOSDAQ"].round(2).tolist(),
        "nh": nh.loc[days].sum(axis=1).astype(int).tolist(),
        "nl": nl.loc[days].sum(axis=1).astype(int).tolist(),
        "active": active.loc[days].sum(axis=1).astype(int).tolist(),
    }

    snaps = []
    for t in snapshot_dates(close.index):
        clusters, singles, n_nh = cluster_at(t, close, nh, value20, high52, logret, mkt, uni)
        snaps.append({"date": t.strftime("%Y-%m-%d"), "nh_window": n_nh,
                      "clusters": clusters, "singles": singles})
    threads = link_threads(snaps)
    for s in snaps:
        for c in s["clusters"]:
            c.pop("_codes")

    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "last_date": breadth["dates"][-1],
        "n_stocks": int(close.shape[1]),
        "params": {"nh_lookback": NH_LOOKBACK, "window": WINDOW, "corr_days": CORR_DAYS,
                   "min_value_eok": MIN_VALUE / 1e8, "corr_th": CORR_TH,
                   "min_cluster": MIN_CLUSTER, "link_th": LINK_TH},
    }
    for name, obj in [("meta", meta), ("breadth", breadth),
                      ("snapshots", snaps), ("threads", threads)]:
        with open(OUT / f"{name}.json", "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    print(f"last={meta['last_date']} snapshots={len(snaps)} threads={len(threads)} "
          f"clusters={sum(len(s['clusters']) for s in snaps)}")


if __name__ == "__main__":
    main()
