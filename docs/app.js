"use strict";

const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 1) => (x == null ? "-" : (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%");
const sign = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const fmtEok = (v) => (v == null ? "-" : v >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString() + "억");
const ym = (d) => d.slice(0, 7);

const S = { years: 3, month: null, sel: null };
let D, charts = {};

async function load() {
  const get = (n) => fetch(`data/${n}.json?v=${Date.now() >> 20}`).then((r) => r.json());
  const [meta, breadth, snaps, threads] = await Promise.all(["meta", "breadth", "snapshots", "threads"].map(get));
  D = { meta, breadth, snaps, threads };
  D.ma = (arr, n) => arr.map((_, i) => (i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
  D.nhMa = D.ma(breadth.nh, 20);
  D.nlMa = D.ma(breadth.nl, 20);
  S.month = snaps.length - 1;
}

/* ---------- 상태 타일 ---------- */
function renderTiles() {
  const b = D.breadth, n = b.dates.length - 1;
  const ma = D.nhMa[n];
  const hist = D.nhMa.filter((v) => v != null);
  const rank = hist.filter((v) => v <= ma).length / hist.length;
  const ratio = b.nh[n] / Math.max(1, b.nh[n] + b.nl[n]);
  const snap = D.snaps[D.snaps.length - 1];
  const strong = snap.clusters.filter((c) => c.size >= 5);
  const top = strong[0];
  const thread = top && D.threads[top.thread];
  const tiles = [
    { k: "오늘 신고가 종목", v: b.nh[n].toLocaleString(), d: `20일 평균 ${ma.toFixed(0)}개 · 상장 ${b.active[n].toLocaleString()}개 중` },
    { k: "20일 평균 신고가 수 · 10년 백분위", v: `${Math.round(rank * 100)}`, d: "100에 가까울수록 신고가가 많은 시기", hot: rank >= 0.8 },
    { k: "신고가 ÷ (신고가+신저가)", v: (ratio * 100).toFixed(0) + "%", d: `신저가 ${b.nl[n]}개`, hot: ratio >= 0.8 },
    { k: "뚜렷한 주도주군 (5종목 이상)", v: strong.length + "개", d: top ? `최대: ${thread.label} (${top.size}종목)` : "없음", hot: strong.length >= 2 },
  ];
  $("#tiles").innerHTML = tiles.map((t) =>
    `<div class="tile"><div class="k">${esc(t.k)}${t.hot ? '<span class="badge hot">강함</span>' : ""}</div>
     <div class="v">${esc(t.v)}</div><div class="d">${esc(t.d)}</div></div>`).join("");
}

/* ---------- 공통 ---------- */
function rangeStart(dates) {
  if (!S.years) return 0;
  const last = new Date(dates[dates.length - 1]);
  last.setFullYear(last.getFullYear() - S.years);
  const s = last.toISOString().slice(0, 10);
  const i = dates.findIndex((d) => d >= s);
  return Math.max(0, i);
}
function baseOpt() {
  return {
    animation: false,
    textStyle: { fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif", color: css("--text-2") },
    grid: { left: 48, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis", backgroundColor: css("--surface"), borderColor: css("--line"),
      textStyle: { color: css("--text"), fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: css("--text-3"), width: 1 } },
    },
  };
}
const axisStyle = () => ({
  axisLine: { lineStyle: { color: css("--line") } }, axisTick: { show: false },
  axisLabel: { color: css("--text-3"), fontSize: 11 }, splitLine: { lineStyle: { color: css("--grid") } },
});
const line = (color) => `<span style="display:inline-block;width:12px;height:2px;background:${color};vertical-align:middle;margin-right:6px"></span>`;

/* ---------- 신고가 폭 ---------- */
function renderBreadth() {
  const b = D.breadth, i0 = rangeStart(b.dates);
  const dates = b.dates.slice(i0);
  const up = css("--up"), down = css("--down");
  const o = baseOpt();
  o.legend = { top: 0, right: 0, textStyle: { color: css("--text-2"), fontSize: 12 }, itemWidth: 14, itemHeight: 2,
    data: [{ name: "신고가", icon: "rect" }, { name: "신저가", icon: "rect" }] };
  o.grid.top = 28;
  o.xAxis = { type: "category", data: dates, ...axisStyle(), splitLine: { show: false } };
  o.yAxis = { type: "value", ...axisStyle(), axisLabel: { color: css("--text-3"), fontSize: 11, formatter: (v) => Math.abs(v) } };
  o.series = [
    { name: "신고가", type: "bar", data: b.nh.slice(i0), itemStyle: { color: up, opacity: 0.35 }, barCategoryGap: "10%", large: true, stack: "x" },
    { name: "신저가", type: "bar", data: b.nl.slice(i0).map((v) => -v), itemStyle: { color: down, opacity: 0.35 }, large: true, stack: "x" },
    { name: "신고가 20일평균", type: "line", data: D.nhMa.slice(i0), showSymbol: false, lineStyle: { width: 2, color: up }, itemStyle: { color: up } },
    { name: "신저가 20일평균", type: "line", data: D.nlMa.slice(i0).map((v) => (v == null ? null : -v)), showSymbol: false, lineStyle: { width: 2, color: down }, itemStyle: { color: down } },
  ];
  o.tooltip.formatter = (ps) => {
    const j = i0 + ps[0].dataIndex;
    return `<b>${b.dates[j]}</b><br>${line(up)}<b>${b.nh[j]}</b> 신고가 <span style="color:${css("--text-3")}">(20일평균 ${D.nhMa[j]?.toFixed(0) ?? "-"})</span>` +
      `<br>${line(down)}<b>${b.nl[j]}</b> 신저가 <span style="color:${css("--text-3")}">(20일평균 ${D.nlMa[j]?.toFixed(0) ?? "-"})</span>` +
      `<br><span style="color:${css("--text-3")}">상장 ${b.active[j]}개 중 신고가 ${(b.nh[j] / b.active[j] * 100).toFixed(1)}%</span>`;
  };
  draw("c-breadth", o);

  const k0 = b.kospi[i0], q0 = b.kosdaq[i0];
  const oi = baseOpt();
  oi.legend = { top: 0, right: 0, textStyle: { color: css("--text-2"), fontSize: 12 }, itemWidth: 14, itemHeight: 2 };
  oi.grid.top = 28;
  oi.xAxis = { type: "category", data: dates, ...axisStyle(), splitLine: { show: false } };
  oi.yAxis = { type: "value", scale: true, ...axisStyle() };
  oi.series = [
    { name: "코스피", type: "line", data: b.kospi.slice(i0).map((v) => +(v / k0 * 100).toFixed(1)), showSymbol: false, lineStyle: { width: 2, color: css("--s1") }, itemStyle: { color: css("--s1") } },
    { name: "코스닥", type: "line", data: b.kosdaq.slice(i0).map((v) => +(v / q0 * 100).toFixed(1)), showSymbol: false, lineStyle: { width: 2, color: css("--s2") }, itemStyle: { color: css("--s2") } },
  ];
  oi.tooltip.formatter = (ps) => {
    const j = i0 + ps[0].dataIndex;
    return `<b>${b.dates[j]}</b><br>${line(css("--s1"))}<b>${b.kospi[j].toLocaleString()}</b> 코스피 (${ps[0].value})` +
      `<br>${line(css("--s2"))}<b>${b.kosdaq[j].toLocaleString()}</b> 코스닥 (${ps[1].value})`;
  };
  draw("c-index", oi);
  echarts.connect([charts["c-breadth"], charts["c-index"]]);
}

/* ---------- 테마 타임라인 ---------- */
function renderThemes() {
  const snaps = D.snaps;
  let k0 = 0;
  if (S.years) {
    const s = snaps[snaps.length - 1].date;
    const y = +s.slice(0, 4) - S.years;
    k0 = Math.max(0, snaps.findIndex((x) => x.date >= y + s.slice(4)));
  }
  const months = snaps.slice(k0).map((s) => ym(s.date));
  // 기간 안에서 존재감이 큰 흐름만 (종목 수 합 상위 30)
  const inRange = D.threads.map((t) => {
    const pts = t.points.filter((p) => p.k >= k0);
    return { t, pts, w: pts.reduce((a, p) => a + p.size, 0), first: pts.length ? pts[0].k : 1e9 };
  }).filter((x) => x.pts.length && (x.w >= 8 || x.pts.some((p) => p.size >= 5)));
  const shown = inRange.sort((a, b) => b.w - a.w).slice(0, 30).sort((a, b) => a.first - b.first || b.w - a.w);
  const cats = shown.map((x) => x.t.label);
  const data = [];
  shown.forEach((x, row) => x.pts.forEach((p) =>
    data.push({ value: [p.k - k0, row, p.size], k: p.k, ci: p.ci, tid: x.t.id })));

  const s1 = css("--up");
  const o = baseOpt();
  const h = Math.max(320, cats.length * 22 + 60);
  $("#c-themes").style.height = h + "px";
  o.grid = { left: 8, right: 16, top: 8, bottom: 28, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: "item", axisPointer: undefined,
    formatter: (p) => {
      const c = snaps[p.data.k].clusters[p.data.ci];
      const names = c.members.slice(0, 5).map((m) => `${esc(m.name)} <span style="color:${css("--text-3")}">${pct(m.r60, 0)}</span>`).join("<br>");
      return `<b>${esc(D.threads[p.data.tid].label)}</b> · ${ym(snaps[p.data.k].date)}<br>` +
        `<b>${c.size}</b>종목 · 60일 중앙 ${pct(c.r60, 0)}<br><br>${names}`;
    } };
  o.xAxis = { type: "category", data: months, ...axisStyle(), splitLine: { show: true, lineStyle: { color: css("--grid") } },
    axisLabel: { color: css("--text-3"), fontSize: 11, interval: (i, v) => v.endsWith("-01") || (S.years && S.years <= 1) } };
  o.yAxis = { type: "category", data: cats, inverse: true, ...axisStyle(), splitLine: { show: false },
    axisLabel: { color: css("--text-2"), fontSize: 12, width: innerWidth < 640 ? 104 : 160, overflow: "truncate" } };
  const sel = S.month - k0;
  o.series = [{
    type: "scatter", data,
    symbolSize: (v) => 6 + Math.sqrt(v[2]) * 4,
    itemStyle: { color: s1, opacity: 0.75, borderColor: css("--surface"), borderWidth: 1.5 },
    emphasis: { itemStyle: { opacity: 1, borderColor: css("--text"), borderWidth: 1.5 } },
    markArea: sel >= 0 ? { silent: true, itemStyle: { color: css("--accent-wash"), opacity: 0.8 },
      data: [[{ xAxis: months[sel] }, { xAxis: months[sel] }]] } : undefined,
  }];
  draw("c-themes", o);
  charts["c-themes"].off("click");
  charts["c-themes"].on("click", (p) => {
    S.month = p.data.k; S.sel = p.data.ci;
    renderDetail(); renderThemes();
    $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ---------- 월별 상세 ---------- */
function memberRows(ms, leadN = 3) {
  const naver = (c) => `https://finance.naver.com/item/main.naver?code=${c}`;
  return `<thead><tr><th>종목</th><th>60일</th><th>20일</th><th>60일 신고가</th><th>거래대금(20일평균)</th><th>52주 고점 대비</th></tr></thead><tbody>` +
    ms.map((m, i) => `<tr class="${i < leadN ? "lead" : ""}">
      <td><a href="${naver(m.code)}" target="_blank" rel="noopener">${esc(m.name)}</a><span class="mk">${esc(m.mkt)}</span></td>
      <td class="${sign(m.r60)}">${pct(m.r60)}</td><td class="${sign(m.r20)}">${pct(m.r20)}</td>
      <td>${m.nh60}회</td><td>${fmtEok(m.val)}</td><td>${pct(m.off)}</td></tr>`).join("") + "</tbody>";
}
function renderDetail() {
  const s = D.snaps[S.month];
  $("#month").value = S.month;
  $("#prev").disabled = S.month === 0;
  $("#next").disabled = S.month === D.snaps.length - 1;
  const inCl = s.clusters.reduce((a, c) => a + c.size, 0);
  $("#detail-sum").textContent = `${s.date} 기준 · 최근 20거래일 신고가 ${s.nh_window}종목 · 주도주군 ${s.clusters.length}개 (${inCl}종목)`;
  $("#clusters").innerHTML = s.clusters.length ? s.clusters.map((c, ci) => {
    const t = D.threads[c.thread];
    const cont = t.points.filter((p) => p.k <= S.month).length;
    const lead = c.members.slice(0, 3).map((m) => m.name).join(", ");
    const hidden = c.members.length > 8;
    return `<div class="cluster ${S.sel === ci ? "sel" : ""}" id="cl-${ci}">
      <div class="cluster-head"><span class="t">${esc(t.label)}</span>
        <span class="m">${c.size}종목 · 60일 중앙 <b class="${sign(c.r60)}">${pct(c.r60)}</b> · 거래대금 합 ${fmtEok(c.val)} · ${cont}개월째</span>
        <span class="m">이달 주도: ${esc(lead)}</span></div>
      <div class="tbl-wrap"><table class="tbl">${memberRows(hidden ? c.members.slice(0, 8) : c.members)}</table></div>
      ${hidden ? `<button class="more" data-ci="${ci}">${c.members.length - 8}종목 더 보기</button>` : ""}
    </div>`;
  }).join("") : `<p class="hint">이 달에는 3종목 이상 묶인 주도주군이 없습니다.</p>`;
  document.querySelectorAll(".more").forEach((b) => b.addEventListener("click", () => {
    const c = s.clusters[+b.dataset.ci];
    b.previousElementSibling.querySelector("table").innerHTML = memberRows(c.members);
    b.remove();
  }));
  $("#singles").innerHTML = s.singles.length ? memberRows(s.singles, 0) : "<tbody><tr><td>없음</td></tr></tbody>";
  if (S.sel != null) document.getElementById(`cl-${S.sel}`)?.scrollIntoView({ block: "nearest" });
}

function renderMethod() {
  const p = D.meta.params;
  $("#method").innerHTML = [
    `신고가: 종가가 직전 ${p.nh_lookback}거래일(52주) 최고 종가를 넘은 날. 상장 후 ${p.nh_lookback}일 미만 종목은 제외.`,
    `주도주군: 매월 말, 최근 ${p.window}거래일 안에 신고가를 낸 종목 중 20일 평균 거래대금 ${p.min_value_eok}억 이상인 종목을 대상으로, 최근 ${p.corr_days}거래일 수익률에서 시장(전 종목 중앙값)을 뺀 초과수익률의 상관관계로 묶음 (평균 상관 ${p.corr_th} 이상, ${p.min_cluster}종목 이상).`,
    `테마 흐름: 앞뒤 달의 주도주군이 구성 종목을 ${p.link_th * 100}% 이상 공유하면 같은 흐름으로 연결. 이름은 그 흐름에서 가장 자주 주도한 종목 2개.`,
    `주도주 순위: 군집 안에서 60일 수익률(40%) · 60일 신고가 횟수(30%) · 거래대금(30%) 순위의 합.`,
    `대상: 코스피·코스닥 보통주 ${D.meta.n_stocks.toLocaleString()}종목 (우선주·스팩 제외). 수정주가 기준.`,
  ].map((x) => `<li>${esc(x)}</li>`).join("");
}

function draw(id, opt) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "canvas" });
  charts[id].setOption(opt, true);
  charts[id].resize();
}

function renderAll() { renderTiles(); renderBreadth(); renderThemes(); renderDetail(); }

(async function main() {
  await load();
  $("#last-date").textContent = D.meta.last_date;
  $("#gen").textContent = "갱신 " + new Date(D.meta.generated_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  $("#month").innerHTML = D.snaps.map((s, k) => `<option value="${k}">${ym(s.date)}${k === D.snaps.length - 1 ? " (최신)" : ""}</option>`).join("");
  $("#month").addEventListener("change", (e) => { S.month = +e.target.value; S.sel = null; renderDetail(); renderThemes(); });
  $("#prev").addEventListener("click", () => { S.month--; S.sel = null; renderDetail(); renderThemes(); });
  $("#next").addEventListener("click", () => { S.month++; S.sel = null; renderDetail(); renderThemes(); });
  document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("on", x === b));
    S.years = +b.dataset.years; renderBreadth(); renderThemes();
  }));
  renderMethod();
  renderAll();
  addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
})();
