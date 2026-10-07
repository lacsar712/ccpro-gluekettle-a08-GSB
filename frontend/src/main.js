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
const today = new Date().toISOString().slice(0, 10);
const state = {
  ready: Boolean(localStorage.getItem(TOKEN_KEY)),
  user: null,
  view: "board",
  board: null,
  picked: null,
  peak: "96",
  err: "",
  certs: null,
  certErr: "",
  filter: { date: "", gate: "", valid: "" },
  issue: { date: today, gate: "open" },
  username: "admin",
  password: "123456",
};

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function refresh() {
  state.board = await api("/api/board");
  if (state.picked) {
    state.picked = state.board.kettles.find((k) => k.id === state.picked.id) || state.board.kettles[0];
  }
}

async function loadCerts() {
  const q = new URLSearchParams();
  if (state.filter.date) q.set("date", state.filter.date);
  if (state.filter.gate) q.set("gate", state.filter.gate);
  if (state.filter.valid) q.set("valid", state.filter.valid);
  const data = await api(`/api/gate-certs?${q}`);
  state.certs = data.certs;
}

function fmtTime(iso) {
  return iso ? iso.replace("T", " ").slice(0, 19) : "—";
}

function topbar() {
  const bar = el(`<nav class="topbar">
    <span class="brand">骨巷熬胶坊</span>
    <button data-view="board">出锅位作业台</button>
    <button data-view="certs">闸板证</button>
    <span class="spacer"></span>
    <span class="who">${state.user ? `${state.user.username} · ${state.user.role === "admin" ? "管理员" : "伙计"}` : ""}</span>
    <button id="logout">退出</button>
  </nav>`);
  bar.querySelectorAll("[data-view]").forEach((b) => {
    if (b.dataset.view === state.view) b.classList.add("active");
    b.onclick = async () => {
      state.view = b.dataset.view;
      state.err = "";
      state.certErr = "";
      if (state.view === "certs" && state.certs === null) {
        try {
          await loadCerts();
        } catch (ex) {
          state.certErr = ex.message;
        }
      }
      render();
    };
  });
  bar.querySelector("#logout").onclick = () => {
    localStorage.removeItem(TOKEN_KEY);
    state.ready = false;
    state.user = null;
    state.board = null;
    state.picked = null;
    state.certs = null;
    render();
  };
  return bar;
}

function boardView(box) {
  const wrap = el(`<div>
    <p>${state.board.alley} · 点锅登记峰值；出胶须最近峰值 ≥ 90℃；熬煮中拨回冷锅须当日开闸证</p>
    <div class="row"></div>
    <section class="drawer"></section>
    <p class="err">${state.err}</p>
  </div>`);
  const row = wrap.querySelector(".row");
  state.board.kettles.forEach((k) => {
    const btn = el(`<button class="kettle ${k.status}"><strong>${k.code}</strong><span>${LABELS[k.status]}</span></button>`);
    btn.onclick = () => {
      state.picked = k;
      render();
    };
    row.append(btn);
  });
  if (state.picked) {
    const d = wrap.querySelector(".drawer");
    d.innerHTML = `<h3>${state.picked.code} · ${LABELS[state.picked.status]}</h3>
      <p>最近峰值：${state.picked.latestPeakC ?? "无"} ℃ · ${state.picked.cookCount} 次</p>
      <input id="peak" value="${state.peak}" />
      <button id="log">登记峰值</button>
      <div>
        <button data-s="cold">冷锅</button>
        <button data-s="boiling">熬煮中</button>
        <button data-s="drawn">已出胶</button>
      </div>
      ${state.picked.status === "boiling" ? '<p class="hint">拨回冷锅须当日开闸证，无证或关闸都拨不动。</p>' : ""}`;
    d.querySelector("#log").onclick = async () => {
      state.err = "";
      state.peak = d.querySelector("#peak").value;
      try {
        state.picked = await api(`/api/kettles/${state.picked.id}/cooks`, {
          method: "POST",
          body: JSON.stringify({ peakTempC: Number(state.peak) }),
        });
        await refresh();
      } catch (ex) {
        state.err = ex.message;
      }
      render();
    };
    d.querySelectorAll("[data-s]").forEach((b) => {
      b.onclick = async () => {
        state.err = "";
        try {
          state.picked = await api(`/api/kettles/${state.picked.id}/status`, {
            method: "POST",
            body: JSON.stringify({ status: b.dataset.s }),
          });
          await refresh();
        } catch (ex) {
          state.err = ex.message;
        }
        render();
      };
    });
  }
  box.append(wrap);
}

function certsView(box) {
  const isAdmin = state.user && state.user.role === "admin";
  const wrap = el(`<div>
    <h2>闸板证</h2>
    <p class="hint">同坊同日最多一张有效证；仅管理员可巡沟开证与作废。</p>
    <div class="filters">
      <label>巡沟日 <input type="date" id="f-date" value="${state.filter.date}" /></label>
      <label>闸态 <select id="f-gate">
        <option value="">全部</option>
        <option value="open" ${state.filter.gate === "open" ? "selected" : ""}>开闸</option>
        <option value="closed" ${state.filter.gate === "closed" ? "selected" : ""}>关闸</option>
      </select></label>
      <label>效力 <select id="f-valid">
        <option value="">全部</option>
        <option value="1" ${state.filter.valid === "1" ? "selected" : ""}>有效</option>
        <option value="0" ${state.filter.valid === "0" ? "selected" : ""}>已作废</option>
      </select></label>
      <button id="f-apply">筛选</button>
    </div>
    <p class="err">${state.certErr}</p>
    <table class="certs">
      <thead><tr><th>巡沟日</th><th>闸态</th><th>巡沟人</th><th>开出时刻</th><th>效力</th><th>作废时刻</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </div>`);
  wrap.querySelector("#f-apply").onclick = async () => {
    state.filter.date = wrap.querySelector("#f-date").value;
    state.filter.gate = wrap.querySelector("#f-gate").value;
    state.filter.valid = wrap.querySelector("#f-valid").value;
    state.certErr = "";
    try {
      await loadCerts();
    } catch (ex) {
      state.certErr = ex.message;
    }
    render();
  };
  if (isAdmin) {
    const form = el(`<form class="issue">
      <strong>按日开证</strong>
      <label>巡沟日 <input type="date" name="date" value="${state.issue.date}" required /></label>
      <label>闸态 <select name="gate">
        <option value="open" ${state.issue.gate === "open" ? "selected" : ""}>开闸</option>
        <option value="closed" ${state.issue.gate === "closed" ? "selected" : ""}>关闸</option>
      </select></label>
      <button>开证</button>
    </form>`);
    form.onsubmit = async (e) => {
      e.preventDefault();
      state.issue.date = form.querySelector("[name=date]").value;
      state.issue.gate = form.querySelector("[name=gate]").value;
      state.certErr = "";
      try {
        await api("/api/gate-certs", {
          method: "POST",
          body: JSON.stringify({ patrolDate: state.issue.date, gate: state.issue.gate }),
        });
        await loadCerts();
      } catch (ex) {
        state.certErr = ex.message;
      }
      render();
    };
    wrap.querySelector(".filters").after(form);
  }
  const tbody = wrap.querySelector("tbody");
  (state.certs || []).forEach((c) => {
    const valid = !c.voidedAt;
    const tr = el(`<tr class="${valid ? "valid" : "voided"}">
      <td>${c.patrolDate}</td>
      <td>${GATE_LABELS[c.gate] || c.gate}</td>
      <td>${c.patroller}</td>
      <td>${fmtTime(c.createdAt)}</td>
      <td>${valid ? "有效" : "已作废"}</td>
      <td>${fmtTime(c.voidedAt)}</td>
      <td></td>
    </tr>`);
    if (isAdmin && valid) {
      const btn = el("<button>作废</button>");
      btn.onclick = async () => {
        state.certErr = "";
        try {
          await api(`/api/gate-certs/${c.id}/void`, { method: "POST" });
          await loadCerts();
        } catch (ex) {
          state.certErr = ex.message;
        }
        render();
      };
      tr.lastElementChild.append(btn);
    }
    tbody.append(tr);
  });
  if (state.certs && state.certs.length === 0) {
    tbody.append(el('<tr><td colspan="7" class="hint">没有符合条件的闸板证</td></tr>'));
  }
  box.append(wrap);
}

function render() {
  app.innerHTML = "";
  if (!state.ready) {
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
      state.err = "";
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: box.querySelector("[name=u]").value,
            password: box.querySelector("[name=p]").value,
          }),
        });
        localStorage.setItem(TOKEN_KEY, data.access_token);
        state.user = data.user;
        state.ready = true;
        await refresh();
      } catch (ex) {
        state.err = ex.message;
      }
      render();
    };
    app.append(box);
    return;
  }
  const box = el(`<div class="wrap"><h1>${state.board ? state.board.workshop : "骨巷熬胶坊"}</h1></div>`);
  box.prepend(topbar());
  if (state.view === "board") {
    if (!state.board) {
      box.append(el(`<p>${state.err || "装载锅位…"}</p>`));
    } else {
      boardView(box);
    }
  } else {
    certsView(box);
  }
  app.append(box);
}

if (state.ready) {
  (async () => {
    try {
      state.user = await api("/api/auth/me");
      await refresh();
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      state.ready = false;
      state.user = null;
      state.err = e.message;
    }
    render();
  })();
} else {
  render();
}
