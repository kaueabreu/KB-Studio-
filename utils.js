export const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatMoneyShort(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000) return "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return formatMoney(n);
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function monthRange(year, month) {
  // month: 0-11
  const from = new Date(year, month, 1).toISOString().slice(0, 10);
  const to = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export function yearMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// Status de um lancamento: pago/recebido, atrasado, vence logo, pendente/a vencer
export function computeStatus(entry) {
  const isIncome = entry.type === "receivable" || entry.type === "rt";
  if (entry.paid) return isIncome ? "recebido" : "pago";

  const today = todayStr();
  const due = entry.due_date;
  if (due < today) return "atrasado";

  const diffDays = (new Date(due) - new Date(today)) / (1000 * 60 * 60 * 24);
  if (!isIncome && diffDays <= 5) return "vence logo";
  return isIncome ? "a vencer" : "pendente";
}

export const STATUS_STYLE = {
  pago: { bg: "var(--bg-success)", fg: "var(--text-success)" },
  recebido: { bg: "var(--bg-success)", fg: "var(--text-success)" },
  atrasado: { bg: "var(--bg-danger)", fg: "var(--text-danger)" },
  "vence logo": { bg: "var(--bg-warning)", fg: "var(--text-warning)" },
  pendente: { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
  "a vencer": { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
};

export function sum(list) {
  return list.reduce((acc, e) => acc + Number(e.amount || 0), 0);
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
