import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// window.supabase vem do script UMD carregado no index.html
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- Auth ----------
export async function signIn(email, password) {
  return sb.auth.signInWithPassword({ email, password });
}
export async function signOut() {
  return sb.auth.signOut();
}
export function onAuthChange(callback) {
  sb.auth.onAuthStateChange((_event, session) => callback(session));
}
export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// ---------- Realtime ----------
export function subscribeToChanges(onChange) {
  sb.channel("kb-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, onChange)
    .subscribe();
}

// ---------- Projects ----------
export async function fetchProjects() {
  const { data, error } = await sb.from("projects").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProjectWithInstallments(project, installments) {
  const { data: proj, error: projErr } = await sb
    .from("projects")
    .insert({ name: project.name, client: project.client, total_value: project.total_value })
    .select()
    .single();
  if (projErr) throw projErr;

  const rows = installments.map((inst) => ({
    type: "receivable",
    category: "Projeto",
    description: project.name,
    project_id: proj.id,
    amount: inst.amount,
    due_date: inst.due_date,
    installment_label: inst.label,
  }));
  if (rows.length) {
    const { error: entErr } = await sb.from("entries").insert(rows);
    if (entErr) throw entErr;
  }
  return proj;
}

export async function deleteProject(id) {
  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// ---------- RTs ----------
export async function createRTWithInstallments(rt, installments) {
  const rows = installments.map((inst, i) => ({
    type: "rt",
    category: "RT",
    description: `RT - ${rt.projectName}`,
    project_id: rt.project_id,
    supplier: rt.supplier,
    amount: inst.amount,
    due_date: inst.due_date,
    installment_label: installments.length > 1 ? `parcela ${i + 1}/${installments.length}` : null,
  }));
  const { error } = await sb.from("entries").insert(rows);
  if (error) throw error;
}

// ---------- Entries (contas a pagar, gastos variaveis, contas a receber, RTs) ----------
// Busca ampla usada pelo dashboard e relatorios (sem filtro de tipo obrigatorio)
export async function fetchEntriesInRange(from, to) {
  const { data, error } = await sb
    .from("entries")
    .select("*, projects(name, client)")
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchAllEntries() {
  const { data, error } = await sb.from("entries").select("*, projects(name, client)").order("due_date", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchEntriesByProject(projectId) {
  const { data, error } = await sb
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createEntry(entry) {
  const { error } = await sb.from("entries").insert(entry);
  if (error) throw error;
}

export async function updateEntry(id, changes) {
  const { error } = await sb.from("entries").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteEntry(id) {
  const { error } = await sb.from("entries").delete().eq("id", id);
  if (error) throw error;
}

export async function togglePaid(entry) {
  const paid = !entry.paid;
  return updateEntry(entry.id, { paid, paid_at: paid ? new Date().toISOString() : null });
}

// ---------- Goals ----------
export async function fetchGoal(yearMonth) {
  const { data, error } = await sb.from("goals").select("*").eq("year_month", yearMonth).maybeSingle();
  if (error) throw error;
  return data;
}

export async function setGoal(yearMonth, targetAmount) {
  const { error } = await sb.from("goals").upsert({ year_month: yearMonth, target_amount: targetAmount });
  if (error) throw error;
}
