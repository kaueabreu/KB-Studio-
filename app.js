import { APP_NAME } from "./config.js";
import * as db from "./db.js";
import { icons } from "./icons.js";
import {
  MONTH_NAMES, formatMoney, formatMoneyShort, formatDate, todayStr,
  monthRange, yearMonthKey, computeStatus, STATUS_STYLE, sum, escapeHtml, uid,
} from "./utils.js";

// ---------------- State ----------------
const state = {
  session: null,
  tab: "dashboard", // dashboard | despesas | receber | projetos | rts | relatorios
  despesasSub: "payable", // payable | variable
  rtsView: "month", // month | open
  dreScope: "consolidado", // consolidado | projeto
  dreProjectId: null,
  date: new Date(), // mes/ano corrente para telas mensais
  year: new Date().getFullYear(), // ano corrente do balanco anual (no dashboard)
  projects: [],
  currentProjectId: null,
  bellOpen: false,
};

const app = document.getElementById("appScreen");
const auth = document.getElementById("authScreen");

// ---------------- Theme ----------------
function initTheme() {
  const saved = localStorage.getItem("kb-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", cur);
  localStorage.setItem("kb-theme", cur);
  renderThemeIcon();
}
function renderThemeIcon() {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.innerHTML = dark ? icons.sun : icons.moon;
}

// ---------------- Auth ----------------
async function initAuth() {
  const session = await db.getSession();
  state.session = session;
  if (session) {
    showApp();
  } else {
    showAuth();
  }
  db.onAuthChange((session) => {
    state.session = session;
    if (session) showApp();
    else showAuth();
  });
}

function showAuth() {
  app.classList.add("hidden");
  auth.classList.remove("hidden");
}

async function showApp() {
  auth.classList.add("hidden");
  app.classList.remove("hidden");
  try {
    state.projects = await db.fetchProjects();
    renderShell();
    await renderTab();
    db.subscribeToChanges(async () => {
      state.projects = await db.fetchProjects();
      renderTab();
    });
  } catch (err) {
    console.error(err);
    app.innerHTML = `
      <div style="max-width:520px; margin:60px auto; padding:24px; font-size:14px; line-height:1.6;">
        <h2 style="margin:0 0 12px;">Não consegui carregar os dados</h2>
        <p style="color:var(--text-secondary, #666);">Isso geralmente acontece quando o SQL ainda não foi rodado no Supabase, ou as tabelas não existem ainda.</p>
        <p style="background:#f2f2f2; padding:12px; border-radius:8px; font-family:monospace; font-size:12px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(err.message || String(err))}</p>
        <button class="primary" onclick="window.location.reload()">Tentar de novo</button>
      </div>
    `;
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("authError");
  errorEl.textContent = "";
  const { error } = await db.signIn(email, password);
  if (error) errorEl.textContent = "E-mail ou senha inválidos.";
});

// ---------------- Shell (topbar + tabs) ----------------
function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><img src="logo-mark.png" alt="${escapeHtml(APP_NAME)}" /></div>
        <div>
          <p class="brand-name">${escapeHtml(APP_NAME)}</p>
          <p class="brand-sub">controle financeiro</p>
        </div>
      </div>
      <div class="topbar-actions">
        <button id="themeToggleBtn" class="icon-btn" aria-label="Alternar tema"></button>
        <button id="bellBtn" class="icon-btn" aria-label="Notificações" style="position:relative;">
          ${icons.bell}
          <span id="bellCount" class="badge-count hidden">0</span>
        </button>
        <button id="logoutBtn" class="icon-btn" aria-label="Sair">${icons.logout}</button>
        <div id="bellPanel"></div>
      </div>
    </header>
    <nav class="tabs" id="tabsNav">
      ${tabButton("dashboard", "Dashboard")}
      ${tabButton("despesas", "Despesas")}
      ${tabButton("receber", "Contas a receber")}
      ${tabButton("projetos", "Projetos")}
      ${tabButton("rts", "RTs")}
      ${tabButton("relatorios", "DRE")}
    </nav>
    <main id="tabContent"></main>
    <div id="modalRoot"></div>
  `;
  renderThemeIcon();
  document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);
  document.getElementById("logoutBtn").addEventListener("click", () => db.signOut());
  document.getElementById("bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    state.bellOpen = !state.bellOpen;
    document.getElementById("bellPanel").style.display = state.bellOpen ? "block" : "none";
  });
  document.addEventListener("click", () => {
    if (state.bellOpen) {
      state.bellOpen = false;
      const p = document.getElementById("bellPanel");
      if (p) p.style.display = "none";
    }
  });
  document.querySelectorAll("#tabsNav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      renderTabsActive();
      renderTab();
    });
  });
  updateBell();
}

function tabButton(id, label) {
  return `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${escapeHtml(label)}</button>`;
}
function renderTabsActive() {
  document.querySelectorAll("#tabsNav button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.tab);
  });
}

// ---------------- Notification bell ----------------
async function updateBell() {
  const today = todayStr();
  const soon = new Date();
  soon.setDate(soon.getDate() + 5);
  const soonStr = soon.toISOString().slice(0, 10);

  const entries = await db.fetchAllEntries();
  const pending = entries.filter((e) => !e.paid);
  const alerts = pending.filter((e) => {
    if (e.type === "payable" || e.type === "variable") return e.due_date <= soonStr;
    return e.due_date < today; // contas a receber e RT: so alerta atrasado
  }).sort((a, b) => a.due_date.localeCompare(b.due_date));

  const countEl = document.getElementById("bellCount");
  const panelEl = document.getElementById("bellPanel");
  if (!countEl || !panelEl) return;

  if (alerts.length) {
    countEl.textContent = alerts.length;
    countEl.classList.remove("hidden");
  } else {
    countEl.classList.add("hidden");
  }

  panelEl.innerHTML = `
    <h3>Pendências</h3>
    ${alerts.length === 0 ? `<p class="bell-empty">Nenhuma pendência no momento.</p>` : alerts.slice(0, 12).map((e) => {
      const status = computeStatus(e);
      const color = status === "atrasado" ? "var(--text-danger)" : "var(--text-warning)";
      return `<div class="bell-item"><span>${escapeHtml(e.description)}</span><span style="color:${color}">${status}</span></div>`;
    }).join("")}
  `;
}

// ---------------- Tab router ----------------
async function renderTab() {
  const el = document.getElementById("tabContent");
  if (!el.dataset.rendered) {
    el.innerHTML = `<p class="empty-state">Carregando...</p>`;
  }
  try {
    if (state.tab === "dashboard") await renderDashboard(el);
    else if (state.tab === "despesas") await renderDespesas(el);
    else if (state.tab === "receber") await renderReceber(el);
    else if (state.tab === "projetos") await renderProjetos(el);
    else if (state.tab === "rts") await renderRTs(el);
    else if (state.tab === "relatorios") await renderRelatorios(el);
    el.dataset.rendered = "1";
  } catch (err) {
    console.error(err);
    el.innerHTML = `<p class="empty-state">Erro ao carregar dados. Tente novamente.</p>`;
  }
  updateBell();
}

// ---------------- Month nav helper ----------------
function periodNavHtml() {
  const label = `${MONTH_NAMES[state.date.getMonth()]} ${state.date.getFullYear()}`;
  return `
    <div class="period-nav">
      <button class="icon-btn" id="prevMonthBtn" aria-label="Mês anterior">${icons.chevronLeft}</button>
      <span>${label}</span>
      <button class="icon-btn" id="nextMonthBtn" aria-label="Próximo mês">${icons.chevronRight}</button>
    </div>
  `;
}
function bindPeriodNav(onChange) {
  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    state.date = new Date(state.date.getFullYear(), state.date.getMonth() - 1, 1);
    onChange();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    state.date = new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1);
    onChange();
  });
}

// ---------------- Pie chart (conic-gradient) ----------------
const PALETTE = ["var(--accent-fg)", "var(--border-strong)", "var(--text-muted)", "var(--surface-2)", "#b98b6b", "#7c8f6e"];
function buildDonut(entriesList) {
  const totals = {};
  entriesList.forEach((e) => {
    const key = e.category || "Outros";
    totals[key] = (totals[key] || 0) + Number(e.amount || 0);
  });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total === 0) return { style: "background: var(--surface-2);", legend: `<p class="bell-empty">Sem dados</p>`, titleText: "Sem lançamentos neste período" };
  let acc = 0;
  const stops = entries.map(([label, v], i) => {
    const start = (acc / total) * 100;
    acc += v;
    const end = (acc / total) * 100;
    return `${PALETTE[i % PALETTE.length]} ${start}% ${end}%`;
  });
  const legend = entries.map(([label], i) => `
    <div class="legend-item"><span class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(label)}</div>
  `).join("");
  const titleText = entries.map(([label, v]) => `${label}: ${formatMoney(v)}`).join("\n");
  return { style: `background: conic-gradient(${stops.join(", ")});`, legend, titleText };
}

// ---------------- DASHBOARD ----------------
async function renderDashboard(el) {
  const { from, to } = monthRange(state.date.getFullYear(), state.date.getMonth());
  const entries = await db.fetchEntriesInRange(from, to);

  const receitaEntries = entries.filter((e) => e.type === "receivable" || e.type === "rt");
  const despesaEntries = entries.filter((e) => e.type === "payable" || e.type === "variable");
  const receitaTotal = sum(receitaEntries);
  const despesaTotal = sum(despesaEntries);
  const saldo = receitaTotal - despesaTotal;

  const totalMovimento = receitaTotal + despesaTotal;
  const pagoRecebido = sum(receitaEntries.filter((e) => e.paid)) + sum(despesaEntries.filter((e) => e.paid));
  const progress = totalMovimento > 0 ? Math.round((pagoRecebido / totalMovimento) * 100) : 0;

  const today = todayStr();
  const atencao = entries.filter((e) => !e.paid && (
    ((e.type === "payable" || e.type === "variable") && e.due_date <= today) ||
    ((e.type === "receivable" || e.type === "rt") && e.due_date < today)
  )).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);

  // ---- Balanco anual ----
  const year = state.year;
  const monthsData = [];
  for (let m = 0; m < 12; m++) {
    const { from: f2, to: t2 } = monthRange(year, m);
    const monthEntries = await db.fetchEntriesInRange(f2, t2);
    monthsData.push({
      recebido: sum(monthEntries.filter((e) => e.type === "receivable" || e.type === "rt")),
      pago: sum(monthEntries.filter((e) => e.type === "payable" || e.type === "variable")),
    });
  }
  const totalRecebidoAno = monthsData.reduce((a, m) => a + m.recebido, 0);
  const totalPagoAno = monthsData.reduce((a, m) => a + m.pago, 0);
  const maxVal = Math.max(1, ...monthsData.flatMap((m) => [m.recebido, m.pago]));

  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const ymKey = yearMonthKey(year, currentMonthIdx);
  let goal = null;
  try { goal = await db.fetchGoal(ymKey); } catch { goal = null; }
  const target = goal?.target_amount || 0;
  let receivedThisMonth = 0;
  if (isCurrentYear) {
    const { from: f3, to: t3 } = monthRange(year, currentMonthIdx);
    const curEntries = await db.fetchEntriesInRange(f3, t3);
    receivedThisMonth = sum(curEntries.filter((e) => (e.type === "receivable" || e.type === "rt") && e.paid));
  }
  const pct = target > 0 ? Math.round((receivedThisMonth / target) * 100) : 0;

  el.innerHTML = `
    ${periodNavHtml()}
    <div class="metrics-row cols-3" style="margin-top:14px;">
      <div class="metric-card"><p class="label">Receita</p><p class="value">${formatMoneyShort(receitaTotal)}</p></div>
      <div class="metric-card"><p class="label">Despesas</p><p class="value">${formatMoneyShort(despesaTotal)}</p></div>
      <div class="metric-card"><p class="label">Saldo</p><p class="value ${saldo >= 0 ? "success" : "danger"}">${formatMoneyShort(saldo)}</p></div>
    </div>
    <div class="panel">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <p style="font-size:13px; color:var(--text-secondary); margin:0;">Pago e recebido no mês</p>
        <p style="font-size:13px; font-weight:700; margin:0;">${progress}%</p>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%;"></div></div>
    </div>

    <div class="panel">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <h3 style="margin:0;">Balanço anual</h3>
        <div class="period-nav" style="gap:6px;">
          <button class="icon-btn" id="prevYearBtn" aria-label="Ano anterior">${icons.chevronLeft}</button>
          <span style="font-size:13px; font-weight:600; min-width:auto;">${year}</span>
          <button class="icon-btn" id="nextYearBtn" aria-label="Próximo ano">${icons.chevronRight}</button>
        </div>
      </div>
      <div class="metrics-row cols-3" style="margin-bottom:14px;">
        <div class="metric-card"><p class="label">Recebido no ano</p><p class="value">${formatMoneyShort(totalRecebidoAno)}</p></div>
        <div class="metric-card"><p class="label">Pago no ano</p><p class="value">${formatMoneyShort(totalPagoAno)}</p></div>
        <div class="metric-card"><p class="label">Saldo acumulado</p><p class="value ${totalRecebidoAno - totalPagoAno >= 0 ? "success" : "danger"}">${formatMoneyShort(totalRecebidoAno - totalPagoAno)}</p></div>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <p style="font-size:12px; color:var(--text-secondary); margin:0;">Recebido vs pago por mês</p>
        <div style="display:flex; gap:10px; font-size:11px; color:var(--text-secondary);">
          <span><span class="legend-dot" style="background:var(--accent-fg); display:inline-block;"></span> Recebido</span>
          <span><span class="legend-dot" style="background:var(--border-strong); display:inline-block;"></span> Pago</span>
        </div>
      </div>
      <div class="bars">
        ${monthsData.map((m, i) => `
          <div class="bar-col ${isCurrentYear && i === currentMonthIdx ? "current" : ""}">
            <div class="bar-pair">
              <div class="bar income" style="height:${Math.max(2, (m.recebido / maxVal) * 100)}%"></div>
              <div class="bar expense" style="height:${Math.max(2, (m.pago / maxVal) * 100)}%"></div>
            </div>
            <span>${MONTH_NAMES[i].slice(0, 3)}</span>
          </div>
        `).join("")}
      </div>
      ${isCurrentYear ? `
      <div style="border-top:0.5px solid var(--border); margin-top:16px; padding-top:14px;">
        <div class="form-actions-row">
          <p style="font-size:13px; font-weight:600; margin:0;">${MONTH_NAMES[currentMonthIdx]} - mês atual</p>
          <button class="subtle" id="editGoalBtn" style="font-size:12px;">Editar meta</button>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:8px;"><span>Meta do mês</span><span>${formatMoney(target)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:8px;"><span>Recebido até agora</span><span>${formatMoney(receivedThisMonth)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:10px; font-weight:600;"><span>Falta para bater a meta</span><span style="color:var(--text-warning)">${formatMoney(Math.max(0, target - receivedThisMonth))}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, pct)}%"></div></div>
        <p class="note">${target > 0 ? `${pct}% da meta - ${pct >= 100 ? "meta batida" : pct >= 70 ? "mês dentro do esperado" : "mês fraco até agora"}` : "Nenhuma meta definida para este mês ainda."}</p>
      </div>` : ""}
    </div>

    <div class="panel">
      <h3>Atenção agora</h3>
      ${atencao.length === 0 ? `<p class="bell-empty">Nada atrasado ou pendente hoje.</p>` : `<div class="list">${atencao.map((e) => rowCardHtml(e, false)).join("")}</div>`}
    </div>
  `;
  bindPeriodNav(() => renderTab());
  document.getElementById("prevYearBtn").addEventListener("click", () => { state.year -= 1; renderTab(); });
  document.getElementById("nextYearBtn").addEventListener("click", () => { state.year += 1; renderTab(); });
  const goalBtn = document.getElementById("editGoalBtn");
  if (goalBtn) goalBtn.addEventListener("click", async () => {
    const val = prompt("Meta de receita para " + MONTH_NAMES[currentMonthIdx] + ":", target || "");
    if (val === null) return;
    const num = Number(val.replace(",", "."));
    if (!isNaN(num)) { await db.setGoal(ymKey, num); renderTab(); }
  });
}

// ---------------- Row card (list item) ----------------
function rowCardHtml(e, editable = true) {
  const status = computeStatus(e);
  const style = STATUS_STYLE[status];
  const isIncome = e.type === "receivable" || e.type === "rt";
  const projectLabel = e.projects?.name ? ` - ${e.projects.name}` : "";
  const sub = `${e.category || ""}${e.installment_label ? " - " + e.installment_label : ""} - ${isIncome ? "previsto" : "vence"} ${formatDate(e.due_date)}${projectLabel}`;
  return `
    <div class="row-card" data-id="${e.id}">
      ${editable ? `<button class="check-circle ${e.paid ? "checked" : ""}" data-action="toggle" aria-label="Marcar como ${isIncome ? "recebido" : "pago"}">${icons.check}</button>` : `<span></span>`}
      <div class="info">
        <p class="title">${escapeHtml(e.description)}${e.supplier ? " - " + escapeHtml(e.supplier) : ""}</p>
        <p class="sub">${escapeHtml(sub)}</p>
      </div>
      <span class="status-badge" style="background:${style.bg}; color:${style.fg};">${status}</span>
      <p class="amount ${e.paid ? "paid" : ""}">${formatMoney(e.amount)}</p>
      ${editable ? `
      <div class="row-actions">
        <button class="icon-btn" data-action="edit" aria-label="Editar">${icons.edit}</button>
        <button class="icon-btn" data-action="delete" aria-label="Excluir">${icons.trash}</button>
      </div>` : ""}
    </div>
  `;
}

function bindRowActions(container, entriesList, { onChanged }) {
  container.querySelectorAll(".row-card").forEach((row) => {
    const id = row.dataset.id;
    const entry = entriesList.find((e) => e.id === id);
    if (!entry) return;
    row.querySelector('[data-action="toggle"]')?.addEventListener("click", async () => {
      await db.togglePaid(entry);
      onChanged();
    });
    row.querySelector('[data-action="edit"]')?.addEventListener("click", () => openEntryModal(entry.type, entry, onChanged));
    row.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      if (confirm("Excluir este lançamento?")) {
        await db.deleteEntry(id);
        onChanged();
      }
    });
  });
}

// ---------------- DESPESAS (contas a pagar + gastos variaveis) ----------------
async function renderDespesas(el) {
  const { from, to } = monthRange(state.date.getFullYear(), state.date.getMonth());
  const entries = await db.fetchEntriesInRange(from, to);
  const list = entries.filter((e) => e.type === state.despesasSub);

  const total = sum(list);
  const pago = sum(list.filter((e) => e.paid));
  const falta = total - pago;
  const donut = buildDonut(list);

  el.innerHTML = `
    <div class="toolbar-row">
      <div class="subtabs" id="despesasSubtabs">
        <button data-sub="payable" class="${state.despesasSub === "payable" ? "active" : ""}">Contas a pagar</button>
        <button data-sub="variable" class="${state.despesasSub === "variable" ? "active" : ""}">Gastos variáveis</button>
      </div>
      <div class="toolbar-right">
        <div class="donut-mini" title="${escapeHtml(donut.titleText)}" style="${donut.style}"></div>
        <button class="primary" id="addDespesaBtn">${icons.plus}&nbsp;${state.despesasSub === "payable" ? "Nova conta a pagar" : "Novo gasto variável"}</button>
      </div>
    </div>
    ${periodNavHtml()}
    <div class="metrics-row cols-3" style="margin-top:14px;">
      <div class="metric-card"><p class="label">Total do mês</p><p class="value">${formatMoneyShort(total)}</p></div>
      <div class="metric-card"><p class="label">Já pago</p><p class="value success">${formatMoneyShort(pago)}</p></div>
      <div class="metric-card"><p class="label">Falta pagar</p><p class="value danger">${formatMoneyShort(falta)}</p></div>
    </div>
    <div class="list" id="despesasList">
      ${list.length === 0 ? `<p class="empty-state">Nenhum lançamento neste mês.</p>` : list.map((e) => rowCardHtml(e)).join("")}
    </div>
  `;
  bindPeriodNav(() => renderTab());
  document.querySelectorAll("#despesasSubtabs button").forEach((b) => {
    b.addEventListener("click", () => { state.despesasSub = b.dataset.sub; renderTab(); });
  });
  document.getElementById("addDespesaBtn").addEventListener("click", () => openEntryModal(state.despesasSub, null, () => renderTab()));
  bindRowActions(document.getElementById("despesasList"), list, { onChanged: () => renderTab() });
}

// ---------------- CONTAS A RECEBER ----------------
async function renderReceber(el) {
  const { from, to } = monthRange(state.date.getFullYear(), state.date.getMonth());
  const entries = await db.fetchEntriesInRange(from, to);
  const list = entries.filter((e) => e.type === "receivable");

  const total = sum(list);
  const recebido = sum(list.filter((e) => e.paid));
  const falta = total - recebido;
  const donut = buildDonut(list.map((e) => ({ ...e, category: e.projects?.name || e.category || "Outros" })));

  el.innerHTML = `
    <div class="toolbar-row">
      ${periodNavHtml()}
      <div class="toolbar-right">
        <div class="donut-mini" title="${escapeHtml(donut.titleText)}" style="${donut.style}"></div>
        <button class="primary" id="addReceberBtn">${icons.plus}&nbsp;Novo lançamento</button>
      </div>
    </div>
    <div class="metrics-row cols-3">
      <div class="metric-card"><p class="label">Total previsto</p><p class="value">${formatMoneyShort(total)}</p></div>
      <div class="metric-card"><p class="label">Já recebido</p><p class="value success">${formatMoneyShort(recebido)}</p></div>
      <div class="metric-card"><p class="label">Falta receber</p><p class="value danger">${formatMoneyShort(falta)}</p></div>
    </div>
    <div class="list" id="receberList">
      ${list.length === 0 ? `<p class="empty-state">Nenhum lançamento neste mês.</p>` : list.map((e) => rowCardHtml(e)).join("")}
    </div>
  `;
  bindPeriodNav(() => renderTab());
  document.getElementById("addReceberBtn").addEventListener("click", () => openEntryModal("receivable", null, () => renderTab()));
  bindRowActions(document.getElementById("receberList"), list, { onChanged: () => renderTab() });
}

// ---------------- PROJETOS ----------------
async function renderProjetos(el) {
  if (state.currentProjectId) return renderProjectDetail(el);

  const projects = state.projects;
  el.innerHTML = `
    <div class="toolbar-row">
      <p style="font-size:13px; color:var(--text-secondary); margin:0;">${projects.length} projeto(s) cadastrado(s)</p>
      <button class="primary" id="addProjectBtn">${icons.plus}&nbsp;Novo projeto</button>
    </div>
    <div class="list" id="projectsList">
      ${projects.length === 0 ? `<p class="empty-state">Nenhum projeto cadastrado ainda.</p>` : ""}
    </div>
  `;
  document.getElementById("addProjectBtn").addEventListener("click", () => openProjectModal(() => renderTab()));

  const listEl = document.getElementById("projectsList");
  for (const p of projects) {
    const entries = await db.fetchEntriesByProject(p.id);
    const recebido = sum(entries.filter((e) => (e.type === "receivable" || e.type === "rt") && e.paid));
    const custos = sum(entries.filter((e) => e.type === "variable" && e.paid));
    const resultado = recebido - custos;
    const card = document.createElement("div");
    card.className = "row-card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div class="info">
        <p class="title">${escapeHtml(p.name)}</p>
        <p class="sub">${escapeHtml(p.client || "")} - recebido ${formatMoneyShort(recebido)}</p>
      </div>
      <p class="amount ${resultado >= 0 ? "income" : "expense"}">${formatMoneyShort(resultado)}</p>
    `;
    card.addEventListener("click", () => { state.currentProjectId = p.id; renderTab(); });
    listEl.appendChild(card);
  }
}

async function renderProjectDetail(el) {
  const project = state.projects.find((p) => p.id === state.currentProjectId);
  if (!project) { state.currentProjectId = null; return renderProjetos(el); }
  const entries = await db.fetchEntriesByProject(project.id);

  const receita = sum(entries.filter((e) => e.type === "receivable" || e.type === "rt"));
  const rt = sum(entries.filter((e) => e.type === "rt"));
  const custos = sum(entries.filter((e) => e.type === "variable"));
  const resultado = receita - custos;

  el.innerHTML = `
    <div class="project-select-row">
      <button class="icon-btn" id="backProjectsBtn" aria-label="Voltar">${icons.arrowLeft}</button>
      <select id="projectSelect">
        ${state.projects.map((p) => `<option value="${p.id}" ${p.id === project.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
      </select>
      <button class="icon-btn danger-text" id="deleteProjectBtn" aria-label="Excluir projeto">${icons.trash}</button>
    </div>
    <div class="metrics-row cols-4">
      <div class="metric-card"><p class="label">Recebido</p><p class="value">${formatMoneyShort(sum(entries.filter(e => e.type === "receivable" && e.paid)))}</p></div>
      <div class="metric-card"><p class="label">RT recebida</p><p class="value">${formatMoneyShort(sum(entries.filter(e => e.type === "rt" && e.paid)))}</p></div>
      <div class="metric-card"><p class="label">Custos</p><p class="value">${formatMoneyShort(custos)}</p></div>
      <div class="metric-card"><p class="label">Resultado</p><p class="value ${resultado >= 0 ? "success" : "danger"}">${formatMoneyShort(resultado)}</p></div>
    </div>
    <div class="panel">
      <h3>DRE simplificado do projeto</h3>
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;"><span>Receita (parcelas + RT)</span><span>${formatMoney(receita)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px; color:var(--text-secondary);"><span>Despesas alocadas ao projeto</span><span>- ${formatMoney(custos)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:700; border-top:0.5px solid var(--border); padding-top:8px;"><span>Resultado</span><span style="color:${resultado >= 0 ? "var(--text-success)" : "var(--text-danger)"}">${formatMoney(resultado)}</span></div>
      <p class="note">Esse DRE organiza os números do projeto para facilitar a conversa com o contador, mas não substitui a apuração contábil oficial.</p>
    </div>
    <p style="font-size:13px; font-weight:600; margin:0 0 8px;">Lançamentos do projeto</p>
    <div class="list" id="projectEntriesList">
      ${entries.length === 0 ? `<p class="empty-state">Nenhum lançamento neste projeto ainda.</p>` : entries.map((e) => {
        const isIncome = e.type === "receivable" || e.type === "rt";
        return `
        <div class="row-card" data-id="${e.id}">
          <span class="icon-btn" style="pointer-events:none; color:${isIncome ? "var(--text-success)" : "var(--text-danger)"};">${isIncome ? icons.arrowDown : icons.arrowUp}</span>
          <div class="info">
            <p class="title">${escapeHtml(e.description)}${e.installment_label ? " - " + escapeHtml(e.installment_label) : ""}</p>
            <p class="sub">${e.paid ? (isIncome ? "Recebido" : "Pago") : "Previsto"} em ${formatDate(e.due_date)}</p>
          </div>
          <p class="amount ${isIncome ? "income" : "expense"}">${isIncome ? "+" : "-"} ${formatMoney(e.amount)}</p>
        </div>`;
      }).join("")}
    </div>
  `;
  document.getElementById("backProjectsBtn").addEventListener("click", () => { state.currentProjectId = null; renderTab(); });
  document.getElementById("projectSelect").addEventListener("change", (e) => { state.currentProjectId = e.target.value; renderTab(); });
  document.getElementById("deleteProjectBtn").addEventListener("click", async () => {
    if (confirm(`Excluir o projeto "${project.name}"? Os lançamentos ligados a ele ficam sem projeto vinculado.`)) {
      await db.deleteProject(project.id);
      state.currentProjectId = null;
      state.projects = await db.fetchProjects();
      renderTab();
    }
  });
}

// ---------------- RTs ----------------
async function renderRTs(el) {
  const isOpenView = state.rtsView === "open";
  let list;
  if (isOpenView) {
    const all = await db.fetchAllEntries();
    list = all.filter((e) => e.type === "rt" && !e.paid).sort((a, b) => a.due_date.localeCompare(b.due_date));
  } else {
    const { from, to } = monthRange(state.date.getFullYear(), state.date.getMonth());
    const entries = await db.fetchEntriesInRange(from, to);
    list = entries.filter((e) => e.type === "rt");
  }
  const totalPrevisto = sum(list.filter((e) => !e.paid));

  el.innerHTML = `
    <div class="toolbar-row">
      <div class="subtabs" id="rtsViewToggle">
        <button data-view="month" class="${!isOpenView ? "active" : ""}">Este mês</button>
        <button data-view="open" class="${isOpenView ? "active" : ""}">Todas em aberto</button>
      </div>
      <button class="primary" id="addRTBtn">${icons.plus}&nbsp;Nova RT</button>
    </div>
    ${isOpenView ? "" : periodNavHtml()}
    <p style="font-size:13px; color:var(--text-secondary); margin:12px 0;">${isOpenView ? "Total em aberto (todos os meses)" : "RT prevista no mês"}: <strong style="color:var(--text-primary)">${formatMoney(totalPrevisto)}</strong></p>
    <div class="list" id="rtsList">
      ${list.length === 0 ? `<p class="empty-state">${isOpenView ? "Nenhuma RT em aberto no momento." : "Nenhuma RT neste mês."}</p>` : list.map((e) => rowCardHtml(e)).join("")}
    </div>
  `;
  if (!isOpenView) bindPeriodNav(() => renderTab());
  document.querySelectorAll("#rtsViewToggle button").forEach((b) => {
    b.addEventListener("click", () => { state.rtsView = b.dataset.view; renderTab(); });
  });
  document.getElementById("addRTBtn").addEventListener("click", () => openRTModal(() => renderTab()));
  bindRowActions(document.getElementById("rtsList"), list, { onChanged: () => renderTab() });
}

// ---------------- DRE ----------------
async function renderRelatorios(el) {
  await renderDRE(el);
}

async function renderDRE(el) {
  const { from, to } = monthRange(state.date.getFullYear(), state.date.getMonth());
  let entries = await db.fetchEntriesInRange(from, to);
  if (state.dreScope === "projeto" && state.dreProjectId) {
    entries = entries.filter((e) => e.project_id === state.dreProjectId);
  }
  const receita = sum(entries.filter((e) => e.type === "receivable" || e.type === "rt"));
  const fixas = sum(entries.filter((e) => e.type === "payable"));
  const variaveis = sum(entries.filter((e) => e.type === "variable"));
  const resultado = receita - fixas - variaveis;

  el.innerHTML = `
    <div class="toolbar-row">
      ${periodNavHtml()}
      <div class="subtabs">
        <button data-scope="consolidado" class="${state.dreScope === "consolidado" ? "active" : ""}">Consolidado</button>
        <button data-scope="projeto" class="${state.dreScope === "projeto" ? "active" : ""}">Por projeto</button>
      </div>
    </div>
    ${state.dreScope === "projeto" ? `
      <div class="form-field" style="max-width:280px;">
        <select id="dreProjectSelect">
          <option value="">Selecione um projeto</option>
          ${state.projects.map((p) => `<option value="${p.id}" ${p.id === state.dreProjectId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
    ` : ""}
    <div class="panel">
      <h3>DRE simplificado ${state.dreScope === "projeto" && state.dreProjectId ? "- " + escapeHtml(state.projects.find(p=>p.id===state.dreProjectId)?.name || "") : "- escritório"}</h3>
      <div style="display:flex; flex-direction:column; gap:10px; font-size:14px;">
        <div style="display:flex; justify-content:space-between;"><span>Receita (parcelas + RT)</span><span style="font-weight:600;">${formatMoney(receita)}</span></div>
        <div style="display:flex; justify-content:space-between; color:var(--text-secondary);"><span>(-) Despesas fixas</span><span>${formatMoney(fixas)}</span></div>
        <div style="display:flex; justify-content:space-between; color:var(--text-secondary);"><span>(-) Despesas variáveis</span><span>${formatMoney(variaveis)}</span></div>
        <div style="display:flex; justify-content:space-between; border-top:0.5px solid var(--border); padding-top:10px; font-weight:700; font-size:16px;"><span>Resultado do mês</span><span style="color:${resultado >= 0 ? "var(--text-success)" : "var(--text-danger)"}">${formatMoney(resultado)}</span></div>
      </div>
      <p class="note">Esse DRE organiza os números para facilitar a apuração de impostos com o contador, mas não substitui a contabilidade oficial.</p>
    </div>
  `;
  bindPeriodNav(() => renderTab());
  el.querySelectorAll("[data-scope]").forEach((b) => {
    b.addEventListener("click", () => { state.dreScope = b.dataset.scope; renderTab(); });
  });
  const projSelect = document.getElementById("dreProjectSelect");
  if (projSelect) projSelect.addEventListener("change", (e) => { state.dreProjectId = e.target.value || null; renderTab(); });
}

// ================= MODALS =================
function modalShell(title, bodyHtml) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-card">
        <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="icon-btn" id="modalCloseBtn" aria-label="Fechar">${icons.x}</button></div>
        ${bodyHtml}
      </div>
    </div>
  `;
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
}
function closeModal() {
  document.getElementById("modalRoot").innerHTML = "";
}

const CATEGORY_OPTIONS = {
  payable: ["Fixa", "Cartão", "Financiamento", "Assinatura", "Outros"],
  variable: ["Material", "Deslocamento", "Impressões", "Escritório", "Outros"],
  receivable: ["Projeto", "Outros"],
  rt: ["RT"],
};

function openEntryModal(type, entry, onSaved) {
  const isEdit = !!entry;
  const titleMap = { payable: "conta a pagar", variable: "gasto variável", receivable: "lançamento a receber", rt: "RT" };
  const cats = CATEGORY_OPTIONS[type] || ["Outros"];
  const projectOptions = state.projects.map((p) => `<option value="${p.id}" ${entry?.project_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
  const isRT = type === "rt";

  modalShell(`${isEdit ? "Editar" : "Novo"} ${titleMap[type] || "lançamento"}`, `
    <form id="entryForm">
      <div class="form-field">
        <label>Descrição</label>
        <input type="text" id="f_description" required value="${escapeHtml(entry?.description || "")}" placeholder="Ex: Aluguel do escritório" />
      </div>
      ${isRT ? `
      <div class="form-field">
        <label>Fornecedor</label>
        <input type="text" id="f_supplier" value="${escapeHtml(entry?.supplier || "")}" placeholder="Marcenaria Vila Nova" />
      </div>` : ""}
      <div class="form-grid">
        <div class="form-field">
          <label>Categoria</label>
          <select id="f_category" ${isRT ? "disabled" : ""}>${cats.map((c) => `<option ${entry?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        </div>
        <div class="form-field">
          <label>Valor</label>
          <input type="number" step="0.01" id="f_amount" required value="${entry?.amount ?? ""}" placeholder="0,00" />
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field">
          <label>Data de vencimento</label>
          <input type="date" id="f_due_date" required value="${entry?.due_date || todayStr()}" />
        </div>
        <div class="form-field">
          <label>Projeto vinculado ${isRT ? "" : "(opcional)"}</label>
          <select id="f_project_id" ${isRT ? "required" : ""}><option value="">${isRT ? "Selecione" : "Sem projeto"}</option>${projectOptions}</select>
        </div>
      </div>
      <button type="submit" class="primary modal-footer-btn">${isEdit ? "Salvar alterações" : "Criar lançamento"}</button>
    </form>
  `);

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type,
      description: document.getElementById("f_description").value.trim(),
      category: document.getElementById("f_category").value,
      amount: Number(document.getElementById("f_amount").value),
      due_date: document.getElementById("f_due_date").value,
      project_id: document.getElementById("f_project_id").value || null,
    };
    if (isRT) payload.supplier = document.getElementById("f_supplier").value.trim();
    if (isEdit) await db.updateEntry(entry.id, payload);
    else await db.createEntry(payload);
    closeModal();
    onSaved();
  });
}

function installmentRowHtml(i, amount = "", date = "") {
  return `
    <div class="installment-row" data-row>
      <span class="num">${i}</span>
      <input type="text" class="inst-label" placeholder="${i === 1 ? "Entrada" : "Parcela " + i}" />
      <input type="number" step="0.01" class="inst-amount" placeholder="Valor" value="${amount}" />
      <input type="date" class="inst-date" value="${date}" />
      <button type="button" class="icon-btn remove-row" aria-label="Remover">${icons.trash}</button>
    </div>
  `;
}

function bindInstallments(container, totalInputId) {
  function recalcTotal() {
    const rows = container.querySelectorAll("[data-row]");
    let total = 0;
    rows.forEach((r) => { total += Number(r.querySelector(".inst-amount").value || 0); });
    const totalTarget = Number(document.getElementById(totalInputId)?.value || 0);
    const totalEl = container.parentElement.querySelector(".installment-total");
    if (totalEl) {
      totalEl.textContent = `Total das parcelas: ${formatMoney(total)}${totalTarget ? (Math.abs(total - totalTarget) < 0.01 ? " - bate com o valor total" : ` - valor total é ${formatMoney(totalTarget)}`) : ""}`;
      totalEl.classList.toggle("mismatch", totalTarget > 0 && Math.abs(total - totalTarget) >= 0.01);
    }
  }
  container.addEventListener("input", recalcTotal);
  container.addEventListener("click", (e) => {
    if (e.target.closest(".remove-row")) {
      e.target.closest("[data-row]").remove();
      recalcTotal();
    }
  });
  recalcTotal();
  return recalcTotal;
}

function readInstallments(container) {
  return [...container.querySelectorAll("[data-row]")].map((r, i) => ({
    label: r.querySelector(".inst-label").value.trim() || `Parcela ${i + 1}`,
    amount: Number(r.querySelector(".inst-amount").value || 0),
    due_date: r.querySelector(".inst-date").value,
  })).filter((i) => i.amount > 0 && i.due_date);
}

function openProjectModal(onSaved) {
  modalShell("Novo projeto", `
    <form id="projectForm">
      <div class="form-field"><label>Nome do projeto</label><input type="text" id="p_name" required placeholder="Residência Almeida" /></div>
      <div class="form-grid">
        <div class="form-field"><label>Cliente</label><input type="text" id="p_client" placeholder="Família Almeida" /></div>
        <div class="form-field"><label>Valor total do contrato</label><input type="number" step="0.01" id="p_total" required placeholder="18000" /></div>
      </div>
      <div class="panel" style="padding:14px;">
        <div class="subtabs" id="paymentTypeToggle" style="margin-bottom:14px;">
          <button type="button" data-ptype="avista">À vista</button>
          <button type="button" data-ptype="parcelado" class="active">Parcelado</button>
        </div>
        <div id="avistaSection" class="hidden">
          <div class="form-field"><label>Data de recebimento</label><input type="date" id="p_avista_date" value="${todayStr()}" /></div>
        </div>
        <div id="parceladoSection">
          <div class="form-actions-row">
            <h3 style="margin:0;">Parcelas (a receber)</h3>
            <button type="button" class="subtle" id="addInstallmentBtn" style="font-size:12px;">${icons.plus} Adicionar</button>
          </div>
          <div id="installmentsContainer">
            ${installmentRowHtml(1)}
          </div>
          <p class="installment-total"></p>
        </div>
      </div>
      <button type="submit" class="primary modal-footer-btn">Criar projeto e lançar parcelas</button>
    </form>
  `);

  const container = document.getElementById("installmentsContainer");
  const recalc = bindInstallments(container, "p_total");
  document.getElementById("p_total").addEventListener("input", recalc);
  let count = 1;
  document.getElementById("addInstallmentBtn").addEventListener("click", () => {
    count += 1;
    container.insertAdjacentHTML("beforeend", installmentRowHtml(count));
    recalc();
  });

  let paymentType = "parcelado";
  document.querySelectorAll("#paymentTypeToggle button").forEach((b) => {
    b.addEventListener("click", () => {
      paymentType = b.dataset.ptype;
      document.querySelectorAll("#paymentTypeToggle button").forEach((x) => x.classList.toggle("active", x === b));
      document.getElementById("avistaSection").classList.toggle("hidden", paymentType !== "avista");
      document.getElementById("parceladoSection").classList.toggle("hidden", paymentType !== "parcelado");
    });
  });

  document.getElementById("projectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const totalValue = Number(document.getElementById("p_total").value || 0);
    let installments;
    if (paymentType === "avista") {
      const date = document.getElementById("p_avista_date").value;
      if (!date || !totalValue) { alert("Preencha o valor e a data de recebimento."); return; }
      installments = [{ label: "À vista", amount: totalValue, due_date: date }];
    } else {
      installments = readInstallments(container);
      if (installments.length === 0) { alert("Adicione ao menos uma parcela válida."); return; }
    }
    const project = {
      name: document.getElementById("p_name").value.trim(),
      client: document.getElementById("p_client").value.trim(),
      total_value: totalValue,
    };
    await db.createProjectWithInstallments(project, installments);
    state.projects = await db.fetchProjects();
    closeModal();
    onSaved();
  });
}

function openRTModal(onSaved) {
  const projectOptions = state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  modalShell("Nova RT", `
    <form id="rtForm">
      <div class="form-field"><label>Projeto vinculado</label><select id="rt_project" required><option value="">Selecione</option>${projectOptions}</select></div>
      <div class="form-grid">
        <div class="form-field"><label>Fornecedor</label><input type="text" id="rt_supplier" placeholder="Marcenaria Vila Nova" /></div>
        <div class="form-field"><label>Valor total da RT</label><input type="number" step="0.01" id="rt_total" required placeholder="1800" /></div>
      </div>
      <div class="panel" style="padding:14px;">
        <div class="form-actions-row">
          <h3 style="margin:0;">Parcelas da RT</h3>
          <button type="button" class="subtle" id="addRtInstallmentBtn" style="font-size:12px;">${icons.plus} Adicionar</button>
        </div>
        <div id="rtInstallmentsContainer">${installmentRowHtml(1)}</div>
        <p class="installment-total"></p>
      </div>
      <button type="submit" class="primary modal-footer-btn">Cadastrar RT e lançar parcelas</button>
    </form>
  `);

  const container = document.getElementById("rtInstallmentsContainer");
  const recalc = bindInstallments(container, "rt_total");
  document.getElementById("rt_total").addEventListener("input", recalc);
  let count = 1;
  document.getElementById("addRtInstallmentBtn").addEventListener("click", () => {
    count += 1;
    container.insertAdjacentHTML("beforeend", installmentRowHtml(count));
    recalc();
  });

  document.getElementById("rtForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const installments = readInstallments(container);
    if (installments.length === 0) { alert("Adicione ao menos uma parcela válida."); return; }
    const projectId = document.getElementById("rt_project").value;
    const projectName = state.projects.find((p) => p.id === projectId)?.name || "";
    await db.createRTWithInstallments({
      project_id: projectId,
      projectName,
      supplier: document.getElementById("rt_supplier").value.trim(),
    }, installments);
    closeModal();
    onSaved();
  });
}

// ---------------- Boot ----------------
initTheme();
initAuth();
