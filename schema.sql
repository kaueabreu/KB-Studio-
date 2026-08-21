-- KB Studio - controle financeiro
-- Rode este arquivo inteiro no SQL Editor do Supabase (Project > SQL Editor > New query)

-- Projetos/clientes
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  total_value numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Metas mensais (para a visao anual)
create table if not exists goals (
  year_month text primary key, -- formato '2026-08'
  target_amount numeric not null default 0
);

-- Todos os lancamentos: contas a pagar, gastos variaveis, contas a receber e RTs
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('payable', 'variable', 'receivable', 'rt')),
  category text,
  description text not null,
  project_id uuid references projects(id) on delete set null,
  supplier text,
  amount numeric not null,
  due_date date not null,
  paid boolean not null default false,
  paid_at timestamptz,
  installment_label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entries_due_date_idx on entries (due_date);
create index if not exists entries_project_id_idx on entries (project_id);
create index if not exists entries_type_idx on entries (type);

-- Segurança: só usuários logados (voce e seu socio) podem ler/escrever
alter table projects enable row level security;
alter table entries enable row level security;
alter table goals enable row level security;

drop policy if exists "projects_all_authenticated" on projects;
create policy "projects_all_authenticated" on projects
  for all to authenticated using (true) with check (true);

drop policy if exists "entries_all_authenticated" on entries;
create policy "entries_all_authenticated" on entries
  for all to authenticated using (true) with check (true);

drop policy if exists "goals_all_authenticated" on goals;
create policy "goals_all_authenticated" on goals
  for all to authenticated using (true) with check (true);

-- Realtime: sincroniza mudancas entre voce e seu socio automaticamente
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table entries;
alter publication supabase_realtime add table goals;

-- Atualiza updated_at sozinho quando um lancamento e editado
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists entries_set_updated_at on entries;
create trigger entries_set_updated_at
  before update on entries
  for each row execute function set_updated_at();
