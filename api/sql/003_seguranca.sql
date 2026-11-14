-- Doca Livre fazumfreela — segurança do acesso pelo PostgREST
--
-- Antes: o papel `web` (usado por qualquer pessoa com a chave pública do site) tinha ALL em
-- todas as tabelas, sem RLS, e as senhas ficavam em texto puro em mao_contas.senha_hash.
-- Agora:
--   * senhas ficam em mao_credenciais (hash scrypt), sem nenhum acesso pelo `web`;
--   * a API emite um token (JWT) no login; o PostgREST expõe as claims em request.jwt.claims;
--   * cada tabela tem RLS: sem token não se lê nada; com token, cada um vê o que é seu,
--     o admin vê tudo; status de aprovação e papel da conta só mudam pelo admin.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'web') then
    create role web nologin;
  end if;
end $$;

-- ---------- Tabelas novas ----------

create table if not exists mao_credenciais (
  conta_id text primary key references mao_contas (id) on delete cascade,
  senha_hash text not null,
  trocar_senha boolean not null default false,
  atualizado_em timestamptz not null default now()
);

alter table mao_email_codigos add column if not exists tentativas int not null default 0;

-- Vagas, candidaturas, contratos, pagamentos etc. (antes só no navegador de quem criou).
create table if not exists mao_registros (
  colecao text not null,
  id text not null,
  empresa_id text,
  profissional_id text,
  publico boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  primary key (colecao, id)
);

create index if not exists mao_registros_empresa_idx on mao_registros (empresa_id);
create index if not exists mao_registros_prof_idx on mao_registros (profissional_id);

-- ---------- Quem está chamando ----------

-- Token "trocar" (senha provisória ainda não trocada) não dá acesso a dados.
create or replace function fz_uid() returns text
language sql stable as $$
  select case when c ->> 'trocar' = 'true' then null else c ->> 'sub' end
  from (select nullif(current_setting('request.jwt.claims', true), '')::json as c) x
$$;

create or replace function fz_logado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mao_contas where id = fz_uid() and ativo)
$$;

create or replace function fz_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mao_contas where id = fz_uid() and ativo and role in ('admin', 'super'))
$$;

create or replace function fz_minha_empresa(eid text) returns boolean
language sql stable security definer set search_path = public as $$
  select eid is not null and exists (
    select 1 from mao_empresas e join mao_contas c on c.id = e.user_id
    where e.id = eid and e.user_id = fz_uid() and c.ativo
  )
$$;

create or replace function fz_meu_profissional(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select pid is not null and exists (
    select 1 from mao_profissionais p join mao_contas c on c.id = p.user_id
    where p.id = pid and p.user_id = fz_uid() and c.ativo
  )
$$;

create or replace function fz_dono_documento(tipo text, dono text) returns boolean
language sql stable as $$
  select case tipo
    when 'empresa' then fz_minha_empresa(dono)
    when 'profissional' then fz_meu_profissional(dono)
    else false
  end
$$;

create or replace function fz_parte(eid text, pid text) returns boolean
language sql stable as $$
  select fz_minha_empresa(eid) or fz_meu_profissional(pid)
$$;

-- ---------- Regras antigas ----------
-- O banco veio do Supabase com uma regra "libera tudo" (using (true)) em cada tabela mao_*.
-- Regras permissivas se somam: deixá-las anularia todas as regras abaixo. Remove todas as que
-- não são deste arquivo (prefixo fz_).
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename like 'mao\_%' and policyname not like 'fz\_%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ---------- Permissões do papel web ----------

revoke all on all tables in schema public from web;
revoke all on all sequences in schema public from web;
alter default privileges in schema public revoke all on tables from web;
alter default privileges in schema public revoke all on sequences from web;
grant usage on schema public to web;

grant select, delete on mao_contas to web;
grant update (usuario, perfil_completo, aceites, updated_at, ativo, role, nivel_hierarquia, superior_usuario)
  on mao_contas to web;
grant select, insert, update, delete on mao_profissionais to web;
grant select, insert, update, delete on mao_empresas to web;
grant select, insert, update, delete on mao_documentos to web;
grant select, insert, update, delete on mao_registros to web;
-- mao_credenciais, mao_email_codigos e as tabelas legadas (mao_usuarios, mao_permissoes,
-- mao_org_nos, mao_grupos_*, mao_app_state, mao_hierarquia_niveis) ficam sem acesso pelo web.

alter table mao_contas enable row level security;
alter table mao_credenciais enable row level security;
alter table mao_email_codigos enable row level security;
alter table mao_profissionais enable row level security;
alter table mao_empresas enable row level security;
alter table mao_documentos enable row level security;
alter table mao_registros enable row level security;
alter table mao_usuarios enable row level security;
alter table mao_permissoes enable row level security;
alter table mao_hierarquia_niveis enable row level security;
alter table mao_org_nos enable row level security;
alter table mao_grupos_hierarquia enable row level security;
alter table mao_grupos_hierarquia_membros enable row level security;
alter table mao_app_state enable row level security;

-- ---------- mao_contas ----------

drop policy if exists fz_contas_ver on mao_contas;
create policy fz_contas_ver on mao_contas for select to web
  using (id = fz_uid() or fz_admin());
drop policy if exists fz_contas_alterar on mao_contas;
create policy fz_contas_alterar on mao_contas for update to web
  using (id = fz_uid() or fz_admin()) with check (id = fz_uid() or fz_admin());
drop policy if exists fz_contas_apagar on mao_contas;
create policy fz_contas_apagar on mao_contas for delete to web
  using (fz_admin() and id <> fz_uid());

create or replace function fz_protege_conta() returns trigger
language plpgsql as $$
begin
  if current_user = 'web' and not fz_admin() then
    new.role := old.role;
    new.ativo := old.ativo;
    new.nivel_hierarquia := old.nivel_hierarquia;
    new.superior_usuario := old.superior_usuario;
  end if;
  return new;
end $$;
drop trigger if exists fz_protege_conta on mao_contas;
create trigger fz_protege_conta before update on mao_contas
  for each row execute function fz_protege_conta();

-- ---------- mao_profissionais / mao_empresas ----------

drop policy if exists fz_prof_ver on mao_profissionais;
create policy fz_prof_ver on mao_profissionais for select to web
  using (fz_admin() or user_id = fz_uid() or (status = 'aprovado' and fz_logado()));
drop policy if exists fz_prof_criar on mao_profissionais;
create policy fz_prof_criar on mao_profissionais for insert to web
  with check (fz_admin() or (user_id = fz_uid() and fz_logado()));
drop policy if exists fz_prof_alterar on mao_profissionais;
create policy fz_prof_alterar on mao_profissionais for update to web
  using (fz_admin() or user_id = fz_uid()) with check (fz_admin() or user_id = fz_uid());
drop policy if exists fz_prof_apagar on mao_profissionais;
create policy fz_prof_apagar on mao_profissionais for delete to web using (fz_admin());

drop policy if exists fz_emp_ver on mao_empresas;
create policy fz_emp_ver on mao_empresas for select to web
  using (fz_admin() or user_id = fz_uid() or (status = 'aprovada' and fz_logado()));
drop policy if exists fz_emp_criar on mao_empresas;
create policy fz_emp_criar on mao_empresas for insert to web
  with check (fz_admin() or (user_id = fz_uid() and fz_logado()));
drop policy if exists fz_emp_alterar on mao_empresas;
create policy fz_emp_alterar on mao_empresas for update to web
  using (fz_admin() or user_id = fz_uid()) with check (fz_admin() or user_id = fz_uid());
drop policy if exists fz_emp_apagar on mao_empresas;
create policy fz_emp_apagar on mao_empresas for delete to web using (fz_admin());

-- Aprovação só pelo admin: quem não é admin cria como pendente e não muda o status.
create or replace function fz_protege_status_prof() returns trigger
language plpgsql as $$
begin
  if current_user = 'web' and not fz_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pendente';
      new.motivo_recusa := null;
    else
      new.status := old.status;
      new.motivo_recusa := old.motivo_recusa;
      new.user_id := old.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fz_protege_status_prof on mao_profissionais;
create trigger fz_protege_status_prof before insert or update on mao_profissionais
  for each row execute function fz_protege_status_prof();

create or replace function fz_protege_status_emp() returns trigger
language plpgsql as $$
begin
  if current_user = 'web' and not fz_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pendente';
      new.motivo_recusa := null;
      -- A empresa não se coloca na hierarquia sozinha: quem posiciona é a gestão.
      new.payload := coalesce(new.payload, '{}'::jsonb) - 'orgTipo' - 'orgPaiId' - 'cadastradaPor';
    else
      new.status := old.status;
      new.motivo_recusa := old.motivo_recusa;
      new.user_id := old.user_id;
      new.payload := (coalesce(new.payload, '{}'::jsonb) - 'orgTipo' - 'orgPaiId' - 'cadastradaPor')
        || jsonb_strip_nulls(jsonb_build_object(
             'orgTipo', old.payload -> 'orgTipo',
             'orgPaiId', old.payload -> 'orgPaiId',
             'cadastradaPor', old.payload -> 'cadastradaPor'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fz_protege_status_emp on mao_empresas;
create trigger fz_protege_status_emp before insert or update on mao_empresas
  for each row execute function fz_protege_status_emp();

-- ---------- mao_documentos ----------

drop policy if exists fz_docs_ver on mao_documentos;
create policy fz_docs_ver on mao_documentos for select to web
  using (fz_admin() or fz_dono_documento(dono_tipo, dono_id));
drop policy if exists fz_docs_criar on mao_documentos;
create policy fz_docs_criar on mao_documentos for insert to web
  with check (fz_admin() or fz_dono_documento(dono_tipo, dono_id));
drop policy if exists fz_docs_alterar on mao_documentos;
create policy fz_docs_alterar on mao_documentos for update to web
  using (fz_admin() or fz_dono_documento(dono_tipo, dono_id))
  with check (fz_admin() or fz_dono_documento(dono_tipo, dono_id));
drop policy if exists fz_docs_apagar on mao_documentos;
create policy fz_docs_apagar on mao_documentos for delete to web
  using (fz_admin() or fz_dono_documento(dono_tipo, dono_id));

-- O dono pode enviar de novo (volta para análise), mas não aprova o próprio documento.
create or replace function fz_protege_documento() returns trigger
language plpgsql as $$
begin
  if current_user = 'web' and not fz_admin() then
    if new.status not in ('pendente', 'em_analise') then
      new.status := case when tg_op = 'UPDATE' then old.status else 'em_analise' end;
    end if;
    if tg_op = 'UPDATE' then
      new.revisado_em := old.revisado_em;
      new.revisado_por := old.revisado_por;
    else
      new.revisado_em := null;
      new.revisado_por := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fz_protege_documento on mao_documentos;
create trigger fz_protege_documento before insert or update on mao_documentos
  for each row execute function fz_protege_documento();

-- ---------- mao_registros ----------

drop policy if exists fz_reg_ver on mao_registros;
create policy fz_reg_ver on mao_registros for select to web
  using (fz_admin() or (publico and fz_logado()) or fz_parte(empresa_id, profissional_id));
drop policy if exists fz_reg_criar on mao_registros;
create policy fz_reg_criar on mao_registros for insert to web
  with check (fz_admin() or (colecao <> 'config' and fz_parte(empresa_id, profissional_id)));
drop policy if exists fz_reg_alterar on mao_registros;
create policy fz_reg_alterar on mao_registros for update to web
  using (fz_admin() or (colecao <> 'config' and fz_parte(empresa_id, profissional_id)))
  with check (fz_admin() or (colecao <> 'config' and fz_parte(empresa_id, profissional_id)));
drop policy if exists fz_reg_apagar on mao_registros;
create policy fz_reg_apagar on mao_registros for delete to web
  using (fz_admin() or fz_minha_empresa(empresa_id));

create or replace function fz_carimba_registro() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(fz_uid(), new.atualizado_por);
  return new;
end $$;
drop trigger if exists fz_carimba_registro on mao_registros;
create trigger fz_carimba_registro before insert or update on mao_registros
  for each row execute function fz_carimba_registro();

-- ---------- O que cada lado vê do outro (LGPD) ----------
-- A política de privacidade aceita no cadastro diz: "A empresa tomadora recebe do trabalhador
-- o necessário para a missão: nome, idade, cidade, cargos, experiência, certificações, categoria
-- da CNH, disponibilidade e avaliação. CPF, RG, telefone, endereço e dados bancários ficam com a
-- fazumfreela." Antes a empresa lia o perfil inteiro (CPF, RG, telefone, endereço, PIX).
-- Agora as tabelas completas só abrem para o dono e o admin; o resto passa pelas vitrines.

create or replace function fz_tem_empresa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mao_empresas e join mao_contas c on c.id = e.user_id
    where e.user_id = fz_uid() and c.ativo
  )
$$;

create or replace function fz_idade(nasc text) returns int
language plpgsql stable as $$
begin
  if nasc is null or nasc !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return date_part('year', age(current_date, substring(nasc from 1 for 10)::date))::int;
exception when others then
  return null;
end $$;

-- Coordenada com 2 casas (~1 km): dá para medir distância sem revelar onde a pessoa mora.
create or replace function fz_coord(v jsonb) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then round((v #>> '{}')::numeric, 2) end
$$;

drop policy if exists fz_prof_ver on mao_profissionais;
create policy fz_prof_ver on mao_profissionais for select to web
  using (fz_admin() or user_id = fz_uid());
drop policy if exists fz_emp_ver on mao_empresas;
create policy fz_emp_ver on mao_empresas for select to web
  using (fz_admin() or user_id = fz_uid());

-- Profissionais aprovados, para quem tem empresa: sem CPF, RG, telefone, nascimento (vai a
-- idade), endereço (vão cidade/UF e coordenada aproximada), PIX, banco e saldo. A foto de perfil
-- vai (opcional; o trabalhador é avisado ao colocar e a política de privacidade cita).
create or replace view mao_profissionais_vitrine with (security_barrier = true) as
  select p.id, p.user_id, p.status,
    (p.payload - 'cpf' - 'rg' - 'telefone' - 'nascimento' - 'pix' - 'banco' - 'saldo' - 'ganhosMes'
      - 'consentimentoPrivacidade' - 'endereco' - 'motivoRecusa')
      || jsonb_build_object(
        'idade', fz_idade(p.payload ->> 'nascimento'),
        'endereco', jsonb_build_object(
          'cep', '', 'rua', '', 'numero', '',
          'cidade', coalesce(p.payload -> 'endereco' ->> 'cidade', ''),
          'estado', coalesce(p.payload -> 'endereco' ->> 'estado', ''),
          'lat', fz_coord(p.payload -> 'endereco' -> 'lat'),
          'lng', fz_coord(p.payload -> 'endereco' -> 'lng')
        )
      ) as payload,
    p.updated_at
  from mao_profissionais p
  where p.status = 'aprovado' and fz_tem_empresa();

-- Empresas aprovadas, para qualquer conta logada: sem CPF do responsável e sem dados
-- financeiros/listas internas (favoritos e bloqueados).
create or replace view mao_empresas_vitrine with (security_barrier = true) as
  select e.id, e.user_id, e.status,
    (e.payload - 'responsavelCpf' - 'saldo' - 'limitePosPago' - 'economiaTotal' - 'diasTaxaZero'
      - 'metaTaxaZero' - 'diasAgenciados' - 'rankingDias' - 'favoritos' - 'bloqueados' - 'motivoRecusa'
      - 'plano') as payload,
    e.updated_at
  from mao_empresas e
  where e.status = 'aprovada' and fz_logado();

-- Situação dos documentos dos profissionais aprovados (a busca da empresa confere CNH, NR35,
-- ASO...). Só tipo, situação e validade: nada de arquivo, nome do arquivo ou observação.
create or replace view mao_documentos_vitrine with (security_barrier = true) as
  select d.id, d.tipo_id, d.dono_tipo, d.dono_id, d.status, d.validade, d.enviado_em
  from mao_documentos d
  join mao_profissionais p on d.dono_tipo = 'profissional' and p.id = d.dono_id
  where p.status = 'aprovado' and fz_tem_empresa();

grant select on mao_profissionais_vitrine, mao_empresas_vitrine, mao_documentos_vitrine to web;
