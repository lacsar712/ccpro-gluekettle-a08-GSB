import "./style.css";

const TOKEN_KEY = "gluekettle_token";
const LABELS = { cold: "冷锅", boiling: "熬煮中", drawn: "已出胶" };
const GATE_LABELS = { open: "开闸", closed: "关闸" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

const app = document.getElementById("app");
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtTs = (iso) => (iso ? iso.slice(0, 19).replace("T", " ") : "—");

const state = {
  ready: Boolean(localStorage.getItem(TOKEN_KEY)),
  view: "bench",
  username: "admin",
  password: "123456",
  role: "",
  board: null,
  picked: null,
  peak: "96",
  todayCert: null,
  certs: null,
  certsShop: "",
  certFilter: { day: "", gate: "", state: "" },
  issueDay: todayISO(),
  issueGate: "open",
  err: "",
};

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function refreshBench() {
  state.board = await api("/api/board");
  const data = await api(`/api/gate-certs?day=${todayISO()}&state=valid`);
  state.todayCert = data.certs[0] || null;
  if (state.picked) {
    state.picked = state.board.kettles.find((k) => k.id === state.picked.id) || state.board.kettles[0];
  }
  render();
}

async function loadCerts() {
  const p = new URLSearchParams();
  if (state.certFilter.day) p.set("day", state.certFilter.day);
  if (state.certFilter.gate) p.set("gate", state.certFilter.gate);
  if (state.certFilter.state) p.set("state", state.certFilter.state);
  const data = await api(`/api/gate-certs?${p.toString()}`);
  state.certs = data.certs;
  state.certsShop = data.workshop;
  render();
}

async function guarded(fn) {
  state.err = "";
  try {
    await fn();
  } catch (ex) {
    state.err = ex.message;
    render();
  }
}

function render() {
  app.innerHTML = "";
  if (!state.ready) {
    renderLogin();
    return;
  }
  app.append(renderNav());
  const wrap = el(`<div class="wrap"></div>`);
  if (state.view === "certs") renderCerts(wrap);
  else renderBench(wrap);
  app.append(wrap);
}

function renderLogin() {
  const box = el(`<div class="wrap">
    <h1>骨巷熬胶坊</h1>
    <p>一排熬锅作业台，原生页面，无前端框架。</p>
    <form autocomplete="off">
      <label>用户名
        <input name="u" autocomplete="off" value="${state.username}" />
      </label>
      <label>密码
        <input name="p" type="password" autocomplete="off" value="${state.password}" />
      </label>
      <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
      <button>登录</button>
    </form>
    <p class="err">${state.err}</p>
  </div>`);
  box.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    await guarded(async () => {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: box.querySelector("[name=u]").value,
          password: box.querySelector("[name=p]").value,
        }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      state.username = data.user.username;
      state.role = data.user.role;
      state.ready = true;
      await refreshBench();
    });
  };
  app.append(box);
}

function renderNav() {
  const nav = el(`<nav class="top">
    <span class="brand">骨巷熬胶坊</span>
    <button data-view="bench" class="${state.view === "bench" ? "on" : ""}">出锅位作业台</button>
    <button data-view="certs" class="${state.view === "certs" ? "on" : ""}">闸板证</button>
    <span class="who">${state.username}${state.role === "admin" ? " · 管理员" : ""}</span>
    <button id="logout">退出</button>
  </nav>`);
  nav.querySelectorAll("[data-view]").forEach((b) => {
    b.onclick = () =>
      guarded(async () => {
        if (state.view === b.dataset.view) return;
        state.view = b.dataset.view;
        if (state.view === "certs") await loadCerts();
        else await refreshBench();
      });
  });
  nav.querySelector("#logout").onclick = () => {
    localStorage.removeItem(TOKEN_KEY);
    Object.assign(state, { ready: false, board: null, picked: null, certs: null, err: "" });
    render();
  };
  return nav;
}

function gateText() {
  return state.todayCert
    ? `${GATE_LABELS[state.todayCert.gate]}（${state.todayCert.patroller} 巡）`
    : "尚无有效证";
}

function renderBench(wrap) {
  if (!state.board) {
    wrap.append(el(`<p>${state.err || "装载锅位…"}</p>`));
    return;
  }
  const gateCls = state.todayCert ? `gate-${state.todayCert.gate}` : "gate-none";
  const box = el(`<div>
    <h1>${state.board.workshop}</h1>
    <p>${state.board.alley} · 点锅登记峰值；出胶须最近峰值 ≥ 90℃ · 今日闸板：<strong class="${gateCls}">${gateText()}</strong></p>
    <div class="row"></div>
    <section class="drawer"></section>
    <p class="err">${state.err}</p>
  </div>`);
  const row = box.querySelector(".row");
  state.board.kettles.forEach((k) => {
    const btn = el(`<button class="kettle ${k.status}"><strong>${k.code}</strong><span>${LABELS[k.status]}</span></button>`);
    btn.onclick = () => {
      state.picked = k;
      render();
    };
    row.append(btn);
  });
  if (state.picked) {
    const gateHint =
      state.picked.status === "boiling"
        ? `<p class="hint">熬煮中拨回冷锅须当日开闸证；当前${gateText()}。</p>`
        : "";
    const d = box.querySelector(".drawer");
    d.innerHTML = `<h3>${state.picked.code} · ${LABELS[state.picked.status]}</h3>
      <p>最近峰值：${state.picked.latestPeakC ?? "无"} ℃ · ${state.picked.cookCount} 次</p>
      <input id="peak" value="${state.peak}" />
      <button id="log">登记峰值</button>
      <div>
        <button data-s="cold">冷锅</button>
        <button data-s="boiling">熬煮中</button>
        <button data-s="drawn">已出胶</button>
      </div>
      ${gateHint}`;
    d.querySelector("#log").onclick = async () => {
      state.peak = d.querySelector("#peak").value;
      await guarded(async () => {
        state.picked = await api(`/api/kettles/${state.picked.id}/cooks`, {
          method: "POST",
          body: JSON.stringify({ peakTempC: Number(state.peak) }),
        });
        await refreshBench();
      });
    };
    d.querySelectorAll("[data-s]").forEach((b) => {
      b.onclick = () =>
        guarded(async () => {
          state.picked = await api(`/api/kettles/${state.picked.id}/status`, {
            method: "POST",
            body: JSON.stringify({ status: b.dataset.s }),
          });
          await refreshBench();
        });
    });
  }
  wrap.append(box);
}

function renderCerts(wrap) {
  const isAdmin = state.role === "admin";
  const box = el(`<div>
    <h1>闸板证</h1>
    <p>同坊同日有效证至多一张；仅管理员可巡沟开证与作废。</p>
    <div class="issue"></div>
    <div class="filters">
      <label>巡沟日 <input type="date" id="f-day" value="${state.certFilter.day}" /></label>
      <label>闸板 <select id="f-gate">
        <option value="">全部</option>
        <option value="open" ${state.certFilter.gate === "open" ? "selected" : ""}>开闸</option>
        <option value="closed" ${state.certFilter.gate === "closed" ? "selected" : ""}>关闸</option>
      </select></label>
      <label>状态 <select id="f-state">
        <option value="">全部</option>
        <option value="valid" ${state.certFilter.state === "valid" ? "selected" : ""}>有效</option>
        <option value="voided" ${state.certFilter.state === "voided" ? "selected" : ""}>已作废</option>
      </select></label>
      <button id="f-clear">清空</button>
    </div>
    <div class="clist"></div>
    <p class="err">${state.err}</p>
  </div>`);

  if (isAdmin) {
    const f = el(`<form class="issue-form">
      <label>巡沟日 <input type="date" name="day" value="${state.issueDay}" required /></label>
      <label>闸板 <select name="gate">
        <option value="open" ${state.issueGate === "open" ? "selected" : ""}>开闸</option>
        <option value="closed" ${state.issueGate === "closed" ? "selected" : ""}>关闸</option>
      </select></label>
      <button>巡沟开证</button>
    </form>`);
    f.onsubmit = async (e) => {
      e.preventDefault();
      state.issueDay = f.querySelector("[name=day]").value;
      state.issueGate = f.querySelector("[name=gate]").value;
      await guarded(async () => {
        await api("/api/gate-certs", {
          method: "POST",
          body: JSON.stringify({ day: state.issueDay, gate: state.issueGate }),
        });
        await loadCerts();
      });
    };
    box.querySelector(".issue").append(f);
  } else {
    box.querySelector(".issue").append(el(`<p class="hint">工人只读；开证与作废须管理员。</p>`));
  }

  const applyFilter = () =>
    guarded(async () => {
      state.certFilter = {
        day: box.querySelector("#f-day").value,
        gate: box.querySelector("#f-gate").value,
        state: box.querySelector("#f-state").value,
      };
      await loadCerts();
    });
  box.querySelector("#f-day").onchange = applyFilter;
  box.querySelector("#f-gate").onchange = applyFilter;
  box.querySelector("#f-state").onchange = applyFilter;
  box.querySelector("#f-clear").onclick = () =>
    guarded(async () => {
      state.certFilter = { day: "", gate: "", state: "" };
      await loadCerts();
    });

  const list = box.querySelector(".clist");
  if (!state.certs) {
    list.append(el(`<p>装载闸板证…</p>`));
  } else if (!state.certs.length) {
    list.append(el(`<p class="hint">没有符合条件的闸板证。</p>`));
  } else {
    const rows = state.certs
      .map(
        (c) => `<tr class="${c.voidedAt ? "voided" : ""}">
          <td>${state.certsShop}</td>
          <td>${c.patrolDate}</td>
          <td><strong class="gate-${c.gate}">${GATE_LABELS[c.gate]}</strong>${c.voidedAt ? "（已作废）" : ""}</td>
          <td>${c.patroller}</td>
          <td>${fmtTs(c.createdAt)}</td>
          <td>${fmtTs(c.voidedAt)}</td>
          <td>${isAdmin && !c.voidedAt ? `<button data-void="${c.id}">作废</button>` : ""}</td>
        </tr>`
      )
      .join("");
    const tbl = el(`<table>
      <thead><tr><th>坊</th><th>巡沟日</th><th>闸板</th><th>巡沟人</th><th>开证时刻</th><th>作废时刻</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
    tbl.querySelectorAll("[data-void]").forEach((b) => {
      b.onclick = () =>
        guarded(async () => {
          await api(`/api/gate-certs/${b.dataset.void}/void`, { method: "POST" });
          await loadCerts();
        });
    });
    list.append(tbl);
  }
  wrap.append(box);
}

async function boot() {
  if (!state.ready) {
    render();
    return;
  }
  await guarded(async () => {
    const me = await api("/api/auth/me");
    state.username = me.username;
    state.role = me.role;
    await refreshBench();
  });
  if (!state.board) render();
}

boot();
