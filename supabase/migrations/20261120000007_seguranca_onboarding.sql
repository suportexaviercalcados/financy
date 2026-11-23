-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0007 RLS, onboarding, usuários/convites, storage, alertas,
-- painel da plataforma e rotinas agendadas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conjuntos de organizações do usuário (avaliados uma vez por consulta)
-- ---------------------------------------------------------------------
create or replace function fn_orgs_leitura() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organizacao_id from membros where user_id = auth.uid()
  union
  select organizacao_id from acessos_suporte
   where admin_user_id = auth.uid() and revogado_em is null and expira_em > now()
$$;
create or replace function fn_orgs_escrita() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organizacao_id from membros where user_id = auth.uid() and papel in ('proprietario','administrador','financeiro')
$$;
create or replace function fn_orgs_admin() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organizacao_id from membros where user_id = auth.uid() and papel in ('proprietario','administrador')
$$;

-- ---------------------------------------------------------------------
-- RLS genérico por classe de tabela
-- ---------------------------------------------------------------------
do $$
declare t text;
  escrita text[] := array['titulos','titulo_anexos','baixas','transferencias','vendas','venda_itens',
    'venda_pagamentos','devolucoes','recorrencias','emprestimos','emprestimo_parcelas','depreciacoes','extratos',
    'transacoes_bancarias','conciliacoes','regras_conciliacao','contatos','produtos','ia_sugestoes','alertas'];
  admin text[] := array['empresas','plano_contas','centros_custo','contas_bancarias','adquirentes','formas_pagamento',
    'canais_venda','canal_taxas','metas','orcamentos','integracoes','integracao_mapeamentos','ia_config',
    'periodos_fechados'];
  leitura text[] := array['movimentos','sync_jobs','sync_logs','ia_execucoes','periodos_reaberturas','assinaturas'];
begin
  foreach t in array escrita || admin || leitura loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy p_select on %I for select to authenticated using (organizacao_id in (select fn_orgs_leitura()))', t);
  end loop;
  foreach t in array escrita loop
    execute format('create policy p_insert on %I for insert to authenticated with check (organizacao_id in (select fn_orgs_escrita()))', t);
    execute format('create policy p_update on %I for update to authenticated using (organizacao_id in (select fn_orgs_escrita())) with check (organizacao_id in (select fn_orgs_escrita()))', t);
    execute format('create policy p_delete on %I for delete to authenticated using (organizacao_id in (select fn_orgs_escrita()))', t);
  end loop;
  foreach t in array admin loop
    execute format('create policy p_insert on %I for insert to authenticated with check (organizacao_id in (select fn_orgs_admin()))', t);
    execute format('create policy p_update on %I for update to authenticated using (organizacao_id in (select fn_orgs_admin())) with check (organizacao_id in (select fn_orgs_admin()))', t);
    execute format('create policy p_delete on %I for delete to authenticated using (organizacao_id in (select fn_orgs_admin()))', t);
  end loop;
end $$;

-- Organização: leitura por membros; atualização restrita a colunas seguras
alter table organizacoes enable row level security;
create policy p_select on organizacoes for select to authenticated using (id in (select fn_orgs_leitura()));
create policy p_update on organizacoes for update to authenticated using (id in (select fn_orgs_admin())) with check (id in (select fn_orgs_admin()));
revoke update on organizacoes from authenticated, anon;
grant update (nome, rateio_modo, onboarding_concluido) on organizacoes to authenticated;
revoke insert, delete on organizacoes from authenticated, anon;

alter table membros enable row level security;
create policy p_select on membros for select to authenticated using (organizacao_id in (select fn_orgs_leitura()));
-- escrita em membros apenas via funções (fn_alterar_papel, fn_remover_membro, fn_aceitar_convite)

alter table profiles enable row level security;
create policy p_self on profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table convites enable row level security;
create policy p_select on convites for select to authenticated using (organizacao_id in (select fn_orgs_admin()));
create policy p_insert on convites for insert to authenticated with check (organizacao_id in (select fn_orgs_admin()));
create policy p_delete on convites for delete to authenticated using (organizacao_id in (select fn_orgs_admin()));

alter table acessos_suporte enable row level security;
create policy p_select on acessos_suporte for select to authenticated
  using (admin_user_id = auth.uid() or fn_is_owner(organizacao_id));
create policy p_insert on acessos_suporte for insert to authenticated
  with check (fn_is_owner(organizacao_id) and concedido_por = auth.uid());
create policy p_update on acessos_suporte for update to authenticated using (fn_is_owner(organizacao_id));

alter table planos enable row level security;
create policy p_select on planos for select to authenticated using (true);

alter table audit_log enable row level security;
create policy p_select on audit_log for select to authenticated using (organizacao_id in (select fn_orgs_admin()));
revoke insert, update, delete on audit_log from authenticated, anon;

alter table ia_config_plataforma enable row level security;
create policy p_select on ia_config_plataforma for select to authenticated using (true);

alter table webhook_eventos enable row level security;
create policy p_select on webhook_eventos for select to authenticated using (organizacao_id in (select fn_orgs_admin()));

-- Somente service_role (Edge Functions)
alter table integracao_tokens enable row level security;
alter table oauth_states enable row level security;
alter table platform_admins enable row level security;
create policy p_self on platform_admins for select to authenticated using (user_id = auth.uid());

-- Logs/execuções não são graváveis pelo cliente
revoke insert, update, delete on sync_logs, ia_execucoes, webhook_eventos from authenticated, anon;
-- sync_jobs: cliente só lê; jobs são criados por função
revoke insert, update, delete on sync_jobs from authenticated, anon;
-- Movimentos são gerados por gatilhos (baixas/transferências): somente leitura para o cliente
revoke insert, update, delete on movimentos from authenticated;
-- Vendas, itens e pagamentos são gravados por fn_registrar_venda (consistência de totais/recebíveis)
revoke insert, update, delete on vendas, venda_itens, venda_pagamentos from authenticated;
grant update (numero, observacoes, contato_id) on vendas to authenticated;
-- Tudo que é anônimo fica fechado
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- Limites do plano
-- ---------------------------------------------------------------------
create or replace function fn_limite_empresas() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from empresas where organizacao_id = new.organizacao_id)
     >= (select p.max_empresas from organizacoes o join planos p on p.id = o.plano_id where o.id = new.organizacao_id) then
    raise exception 'Limite de empresas do plano atingido. Faça upgrade do plano.';
  end if;
  return new;
end $$;
create trigger t_limite_empresas before insert on empresas for each row execute function fn_limite_empresas();

-- ---------------------------------------------------------------------
-- Plano de contas padrão para varejo (classificado para DRE e DFC)
-- ---------------------------------------------------------------------
create or replace function fn_seed_plano_contas(p_org uuid) returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from (values
    ('1',null,'Receitas','entrada','receita_bruta','operacional',null,false),
    ('1.1','1','Receita de vendas de mercadorias','entrada','receita_bruta','operacional','receita_vendas',true),
    ('1.2','1','Receita de serviços','entrada','receita_bruta','operacional',null,true),
    ('1.3','1','Outras receitas operacionais','entrada','receita_bruta','operacional',null,true),
    ('2',null,'Deduções da receita','saida','deducoes_impostos','operacional',null,false),
    ('2.1','2','Impostos sobre vendas (DAS/ICMS/PIS/COFINS)','saida','deducoes_impostos','operacional','impostos_vendas',true),
    ('2.2','2','Devoluções de vendas','saida','deducoes_devolucoes','operacional','devolucoes_vendas',true),
    ('2.3','2','Descontos concedidos','saida','deducoes_devolucoes','operacional','descontos_concedidos',true),
    ('3',null,'Custos das mercadorias','saida','cmv','operacional',null,false),
    ('3.1','3','CMV — Custo das mercadorias vendidas','saida','cmv','operacional','cmv',true),
    ('3.2','3','Compras de mercadorias (estoque)','saida','nao_dre','operacional',null,true),
    ('4',null,'Despesas variáveis de venda','saida','despesa_variavel','operacional',null,false),
    ('4.1','4','Taxas de cartão e meios de pagamento','saida','despesa_variavel','operacional','taxas_cartao',true),
    ('4.2','4','Taxas de marketplace','saida','despesa_variavel','operacional','taxas_marketplace',true),
    ('4.3','4','Comissões sobre vendas','saida','despesa_variavel','operacional','comissoes',true),
    ('4.4','4','Fretes sobre vendas','saida','despesa_variavel','operacional','fretes',true),
    ('4.5','4','Embalagens','saida','despesa_variavel','operacional',null,true),
    ('5',null,'Despesas fixas','saida','despesa_fixa','operacional',null,false),
    ('5.1','5','Pessoal','saida','despesa_fixa','operacional',null,false),
    ('5.1.1','5.1','Salários e encargos','saida','despesa_fixa','operacional',null,true),
    ('5.1.2','5.1','Pró-labore','saida','despesa_fixa','operacional',null,true),
    ('5.1.3','5.1','Benefícios','saida','despesa_fixa','operacional',null,true),
    ('5.2','5','Ocupação','saida','despesa_fixa','operacional',null,false),
    ('5.2.1','5.2','Aluguel e condomínio','saida','despesa_fixa','operacional',null,true),
    ('5.2.2','5.2','Energia, água e internet','saida','despesa_fixa','operacional',null,true),
    ('5.3','5','Administrativas','saida','despesa_fixa','operacional',null,false),
    ('5.3.1','5.3','Contabilidade','saida','despesa_fixa','operacional',null,true),
    ('5.3.2','5.3','Sistemas e assinaturas','saida','despesa_fixa','operacional',null,true),
    ('5.3.3','5.3','Material de escritório e limpeza','saida','despesa_fixa','operacional',null,true),
    ('5.3.4','5.3','Outras despesas administrativas','saida','despesa_fixa','operacional',null,true),
    ('5.4','5','Marketing','saida','despesa_fixa','operacional',null,false),
    ('5.4.1','5.4','Anúncios e mídia paga','saida','despesa_fixa','operacional',null,true),
    ('5.4.2','5.4','Marketing e publicidade','saida','despesa_fixa','operacional',null,true),
    ('6',null,'Resultado financeiro','saida','despesa_financeira','operacional',null,false),
    ('6.1','6','Rendimentos de aplicações','entrada','receita_financeira','operacional',null,true),
    ('6.2','6','Juros e multas recebidos','entrada','receita_financeira','operacional','juros_multas_recebidos',true),
    ('6.3','6','Descontos obtidos','entrada','receita_financeira','operacional','descontos_obtidos',true),
    ('6.4','6','Tarifas bancárias','saida','despesa_financeira','operacional',null,true),
    ('6.5','6','Juros e multas pagos','saida','despesa_financeira','operacional','juros_multas_pagos',true),
    ('6.6','6','Juros de empréstimos e financiamentos','saida','despesa_financeira','operacional','juros_emprestimos',true),
    ('6.7','6','Descontos financeiros concedidos','saida','despesa_financeira','operacional','descontos_financeiros',true),
    ('6.8','6','Custo de antecipação de recebíveis','saida','despesa_financeira','operacional',null,true),
    ('7',null,'Depreciação e impostos sobre o lucro','saida','depreciacao','nao_dfc',null,false),
    ('7.1','7','Depreciação','saida','depreciacao','nao_dfc','depreciacao',true),
    ('7.2','7','IRPJ e CSLL','saida','impostos_lucro','operacional',null,true),
    ('8',null,'Investimentos','saida','nao_dre','investimento',null,false),
    ('8.1','8','Aquisição de imobilizado','saida','nao_dre','investimento',null,true),
    ('8.2','8','Venda de imobilizado','entrada','nao_dre','investimento',null,true),
    ('9',null,'Financiamentos','entrada','nao_dre','financiamento',null,false),
    ('9.1','9','Captação de empréstimos','entrada','nao_dre','financiamento','captacao_emprestimos',true),
    ('9.2','9','Amortização de empréstimos','saida','nao_dre','financiamento','amortizacao_emprestimos',true),
    ('9.3','9','Aporte de sócios','entrada','nao_dre','financiamento',null,true),
    ('9.4','9','Distribuição de lucros','saida','nao_dre','financiamento',null,true),
    ('10',null,'Outros movimentos','saida','nao_dre','operacional',null,false),
    ('10.1','10','Reembolso a clientes (devoluções)','saida','nao_dre','operacional','reembolso_clientes',true)
  ) v(codigo, pai, nome, natureza, dre, dfc, chave, aceita) loop
    insert into plano_contas (organizacao_id, parent_id, codigo, nome, natureza, dre_grupo, dfc_grupo, chave_sistema, aceita_lancamento)
    values (p_org, (select id from plano_contas where organizacao_id = p_org and codigo = r.pai), r.codigo, r.nome,
            r.natureza, r.dre::dre_grupo, r.dfc::dfc_grupo, r.chave, r.aceita)
    on conflict (organizacao_id, codigo) do nothing;
  end loop;
end $$;
revoke execute on function fn_seed_plano_contas(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Onboarding: cria organização + empresa + estrutura padrão
-- ---------------------------------------------------------------------
create or replace function fn_criar_organizacao(p_nome text, p_empresa jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if (select count(*) from membros where user_id = v_uid and papel = 'proprietario') >= 5 then
    raise exception 'Limite de organizações por usuário atingido.';
  end if;
  insert into organizacoes (nome) values (trim(p_nome)) returning id into v_org;
  insert into assinaturas (organizacao_id, plano_id, status, fim) values (v_org, 'essencial', 'trial', current_date + 30);
  insert into membros (organizacao_id, user_id, papel) values (v_org, v_uid, 'proprietario');
  insert into ia_config (organizacao_id) values (v_org);
  perform fn_seed_plano_contas(v_org);
  insert into centros_custo (organizacao_id, codigo, nome) values (v_org, '01', 'Geral');
  insert into formas_pagamento (organizacao_id, nome, tipo) values
    (v_org,'Dinheiro','dinheiro'), (v_org,'PIX','pix'), (v_org,'Cartão de débito','debito'),
    (v_org,'Cartão de crédito','credito'), (v_org,'Boleto','boleto'), (v_org,'Transferência','transferencia'),
    (v_org,'Repasse marketplace','marketplace'), (v_org,'Crediário','crediario');
  insert into empresas (organizacao_id, razao_social, nome_fantasia, cnpj, regime_tributario, aliquota_imposto_vendas, imposto_vendas_modo)
  values (v_org, coalesce(nullif(trim(p_empresa->>'razao_social'),''), trim(p_nome)), nullif(trim(p_empresa->>'nome_fantasia'),''),
          nullif(regexp_replace(coalesce(p_empresa->>'cnpj',''), '\D', '', 'g'), ''),
          coalesce(p_empresa->>'regime_tributario','simples')::regime_tributario,
          coalesce((p_empresa->>'aliquota_imposto_vendas')::numeric, 0),
          coalesce(p_empresa->>'imposto_vendas_modo','estimado'));
  insert into profiles (user_id, organizacao_ativa_id) values (v_uid, v_org)
  on conflict (user_id) do update set organizacao_ativa_id = excluded.organizacao_ativa_id;
  return v_org;
end $$;

-- Perfil automático no cadastro
create or replace function fn_novo_usuario() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, nome, email) values (new.id, new.raw_user_meta_data->>'nome', new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger t_novo_usuario after insert on auth.users for each row execute function fn_novo_usuario();

-- ---------------------------------------------------------------------
-- Usuários e convites
-- ---------------------------------------------------------------------
create or replace function fn_membros(p_org uuid)
returns table (user_id uuid, email text, nome text, papel papel_membro, desde timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, p.nome, m.papel, m.created_at
    from membros m join auth.users u on u.id = m.user_id left join profiles p on p.user_id = m.user_id
   where m.organizacao_id = p_org and fn_can_read(p_org)
   order by m.created_at
$$;

create or replace function fn_aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convites%rowtype; v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  select * into c from convites where token = p_token for update;
  if c.id is null or c.aceito_em is not null or c.expira_em < now() then raise exception 'Convite inválido ou expirado.'; end if;
  if lower(c.email) <> lower(v_email) then raise exception 'Este convite foi enviado para outro e-mail.'; end if;
  if (select count(*) from membros where organizacao_id = c.organizacao_id)
     >= (select p.max_usuarios from organizacoes o join planos p on p.id = o.plano_id where o.id = c.organizacao_id) then
    raise exception 'Limite de usuários do plano atingido.';
  end if;
  insert into membros (organizacao_id, user_id, papel) values (c.organizacao_id, auth.uid(), c.papel)
  on conflict (organizacao_id, user_id) do update set papel = excluded.papel;
  update convites set aceito_em = now() where id = c.id;
  insert into profiles (user_id, organizacao_ativa_id) values (auth.uid(), c.organizacao_id)
  on conflict (user_id) do update set organizacao_ativa_id = excluded.organizacao_ativa_id;
  return c.organizacao_id;
end $$;

-- Convites pendentes para o e-mail do usuário logado (exibidos após login)
create or replace function fn_meus_convites() returns table (token text, organizacao text, papel papel_membro, expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  select c.token, o.nome, c.papel, c.expira_em from convites c join organizacoes o on o.id = c.organizacao_id
   where lower(c.email) = lower((select email from auth.users where id = auth.uid()))
     and c.aceito_em is null and c.expira_em > now()
$$;

create or replace function fn_alterar_papel(p_org uuid, p_user uuid, p_papel papel_membro) returns void
language plpgsql security definer set search_path = public as $$
declare v_atual papel_membro;
begin
  if not fn_can_admin(p_org) then raise exception 'Sem permissão.'; end if;
  select papel into v_atual from membros where organizacao_id = p_org and user_id = p_user;
  if v_atual is null then raise exception 'Usuário não pertence à organização.'; end if;
  if (v_atual = 'proprietario' or p_papel = 'proprietario') and not fn_is_owner(p_org) then
    raise exception 'Somente o proprietário pode alterar papéis de proprietário.';
  end if;
  if v_atual = 'proprietario' and p_papel <> 'proprietario'
     and (select count(*) from membros where organizacao_id = p_org and papel = 'proprietario') = 1 then
    raise exception 'A organização precisa de ao menos um proprietário.';
  end if;
  update membros set papel = p_papel where organizacao_id = p_org and user_id = p_user;
  insert into audit_log (organizacao_id, tabela, registro_id, acao, antes, depois)
  values (p_org, 'membros', p_user::text, 'alterar_papel', jsonb_build_object('papel', v_atual), jsonb_build_object('papel', p_papel));
end $$;

create or replace function fn_remover_membro(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_atual papel_membro;
begin
  if not fn_can_admin(p_org) then raise exception 'Sem permissão.'; end if;
  select papel into v_atual from membros where organizacao_id = p_org and user_id = p_user;
  if v_atual = 'proprietario' then
    if not fn_is_owner(p_org) then raise exception 'Somente o proprietário pode remover outro proprietário.'; end if;
    if (select count(*) from membros where organizacao_id = p_org and papel = 'proprietario') = 1 then
      raise exception 'A organização precisa de ao menos um proprietário.';
    end if;
  end if;
  delete from membros where organizacao_id = p_org and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Storage: bucket privado de anexos, pasta raiz = organizacao_id
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp','application/xml','text/xml',
              'application/x-ofx','application/octet-stream','text/plain'])
on conflict (id) do nothing;

create policy anexos_select on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] in (select fn_orgs_leitura()::text));
create policy anexos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] in (select fn_orgs_escrita()::text));
create policy anexos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] in (select fn_orgs_escrita()::text));

-- ---------------------------------------------------------------------
-- Alertas do sistema (determinísticos, a partir dos dados)
-- ---------------------------------------------------------------------
-- Número no formato brasileiro (1.234,56), independente do locale do servidor
create or replace function fn_num_br(v numeric) returns text language sql immutable as $$
  select translate(to_char(round(v, 2), 'FM999G999G999G990D00'), ',.', '.,')
$$;

create or replace function fn_gerar_alertas(p_org uuid) returns int language plpgsql as $$
declare n int := 0; v_dia date; v_min numeric; v_qtd int; v_valor numeric; r record;
  v_mc_atual numeric; v_mc_ant numeric;
begin
  -- Caixa projetado negativo (90 dias)
  select min(data), min(saldo) into v_dia, v_min from fn_projecao_diaria(p_org, null, 90) where saldo < 0;
  if v_dia is not null then
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave, referencia)
    values (p_org, 'caixa_negativo', 'critico', 'Caixa projetado negativo',
      'O saldo projetado fica negativo em ' || to_char(v_dia,'DD/MM/YYYY') || ' (menor saldo previsto: R$ ' ||
      fn_num_br(v_min) || ').', 'caixa_negativo:' || v_dia, jsonb_build_object('data', v_dia))
    on conflict do nothing; if found then n := n + 1; end if;
  end if;
  -- Contas vencidas
  select count(*), coalesce(sum(valor - valor_pago),0) into v_qtd, v_valor from titulos
   where organizacao_id = p_org and status in ('aberto','parcial') and data_vencimento < current_date;
  if v_qtd > 0 then
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave)
    values (p_org, 'vencidas', 'aviso', v_qtd || ' conta(s) vencida(s)',
      'Há ' || v_qtd || ' título(s) vencido(s) somando R$ ' || fn_num_br(v_valor) || '.',
      'vencidas:' || current_date)
    on conflict do nothing; if found then n := n + 1; end if;
  end if;
  -- Vencimentos a pagar nos próximos 3 dias
  select count(*), coalesce(sum(valor - valor_pago),0) into v_qtd, v_valor from titulos
   where organizacao_id = p_org and tipo = 'pagar' and status in ('aberto','parcial')
     and data_vencimento between current_date and current_date + 3;
  if v_qtd > 0 then
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave)
    values (p_org, 'vencimentos', 'info', 'Vencimentos nos próximos 3 dias',
      v_qtd || ' conta(s) a pagar vencem até ' || to_char(current_date + 3,'DD/MM/YYYY') || ': R$ ' || fn_num_br(v_valor) || '.',
      'vencimentos:' || current_date)
    on conflict do nothing; if found then n := n + 1; end if;
  end if;
  -- Margem de contribuição em queda (mês atual x anterior, > 5 p.p.)
  select round(100 * margem_contribuicao / nullif(receita_liquida,0), 2) into v_mc_atual
    from fn_dre(p_org, null, date_trunc('month', current_date)::date, current_date, 'total');
  select round(100 * margem_contribuicao / nullif(receita_liquida,0), 2) into v_mc_ant
    from fn_dre(p_org, null, (date_trunc('month', current_date) - interval '1 month')::date,
                (date_trunc('month', current_date) - interval '1 day')::date, 'total');
  if v_mc_atual is not null and v_mc_ant is not null and v_mc_ant - v_mc_atual > 5 then
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave)
    values (p_org, 'margem_queda', 'aviso', 'Margem de contribuição em queda',
      'A margem de contribuição caiu de ' || v_mc_ant || '% para ' || v_mc_atual || '% em relação ao mês anterior.',
      'margem:' || to_char(current_date,'YYYY-MM'))
    on conflict do nothing; if found then n := n + 1; end if;
  end if;
  -- Despesa fora do padrão: categoria no mês > 1,5× média dos 3 meses anteriores (mín. R$ 500)
  for r in
    with atual as (
      select categoria_id, categoria, sum(valor) v from fn_dre_categorias(p_org, null, date_trunc('month', current_date)::date, current_date, 'total')
       where grupo in ('despesa_fixa','despesa_variavel','despesa_financeira') group by 1,2),
    hist as (
      select categoria_id, sum(valor) / 3 media from fn_dre_categorias(p_org, null,
        (date_trunc('month', current_date) - interval '3 months')::date, (date_trunc('month', current_date) - interval '1 day')::date, 'total')
       where grupo in ('despesa_fixa','despesa_variavel','despesa_financeira') group by 1)
    select a.categoria_id, a.categoria, a.v, h.media from atual a join hist h using (categoria_id)
     where h.media > 0 and a.v > 1.5 * h.media and a.v - h.media >= 500
  loop
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave, referencia)
    values (p_org, 'despesa_atipica', 'aviso', 'Despesa acima do padrão: ' || r.categoria,
      r.categoria || ' soma R$ ' || fn_num_br(r.v) || ' no mês, contra média de R$ ' ||
      fn_num_br(r.media) || ' nos 3 meses anteriores.',
      'despesa:' || r.categoria_id || ':' || to_char(current_date,'YYYY-MM'), jsonb_build_object('categoria_id', r.categoria_id))
    on conflict do nothing; if found then n := n + 1; end if;
  end loop;
  -- Produtos sem custo (CMV incompleto)
  select count(*) into v_qtd from produtos where organizacao_id = p_org and ativo and custo is null;
  if v_qtd > 0 then
    insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave)
    values (p_org, 'produtos_sem_custo', 'aviso', v_qtd || ' produto(s) sem custo cadastrado',
      'O CMV e as margens ficam incompletos enquanto houver produtos sem custo.', 'sem_custo:' || to_char(current_date,'IYYY-IW'))
    on conflict do nothing; if found then n := n + 1; end if;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Painel do dono da plataforma (sem acesso a dados financeiros detalhados)
-- ---------------------------------------------------------------------
create or replace function fn_admin_organizacoes()
returns table (id uuid, nome text, plano_id text, status text, criada_em timestamptz, usuarios bigint, empresas bigint,
               ia_tokens_mes bigint, ia_execucoes_mes bigint, integracoes jsonb, assinatura text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fn_is_platform_admin() then raise exception 'Acesso restrito ao administrador da plataforma.'; end if;
  return query
  select o.id, o.nome, o.plano_id, o.status, o.created_at,
    (select count(*) from membros m where m.organizacao_id = o.id),
    (select count(*) from empresas e where e.organizacao_id = o.id),
    (select coalesce(sum(prompt_tokens + completion_tokens),0)::bigint from ia_execucoes x
      where x.organizacao_id = o.id and x.created_at >= date_trunc('month', now())),
    (select count(*) from ia_execucoes x where x.organizacao_id = o.id and x.created_at >= date_trunc('month', now())),
    (select coalesce(jsonb_agg(jsonb_build_object('provedor', i.provedor, 'status', i.status,
             'ultima_sincronizacao', i.ultima_sincronizacao, 'ultimo_erro', i.ultimo_erro)), '[]')
       from integracoes i where i.organizacao_id = o.id),
    (select a.status from assinaturas a where a.organizacao_id = o.id)
  from organizacoes o order by o.created_at desc;
end $$;

create or replace function fn_admin_set_plano(p_org uuid, p_plano text, p_status text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not fn_is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  update organizacoes set plano_id = p_plano, status = coalesce(p_status, status) where id = p_org;
  update assinaturas set plano_id = p_plano where organizacao_id = p_org;
  insert into audit_log (organizacao_id, tabela, registro_id, acao, depois)
  values (p_org, 'organizacoes', p_org::text, 'admin_set_plano', jsonb_build_object('plano', p_plano, 'status', p_status));
end $$;

create or replace function fn_admin_ia_config(p_modelo text, p_modelos jsonb, p_prompt text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not fn_is_platform_admin() then raise exception 'Acesso restrito.'; end if;
  update ia_config_plataforma set modelo_padrao = p_modelo, modelos_disponiveis = p_modelos,
         prompt_sistema = p_prompt, updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- Rotinas agendadas (pg_cron)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function fn_rotina_diaria() returns void language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  perform fn_gerar_recorrencias(current_date + 365);
  for o in select id from organizacoes where status = 'ativa' loop
    begin
      perform fn_gerar_alertas(o);
    exception when others then
      insert into sync_logs (organizacao_id, nivel, mensagem, detalhes) values (o, 'erro', 'Falha ao gerar alertas', jsonb_build_object('erro', sqlerrm));
    end;
  end loop;
end $$;
revoke execute on function fn_rotina_diaria() from public, anon, authenticated;

-- Dispara o worker de sincronização (Edge Function) usando segredos do Vault:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
create or replace function fn_disparar_sync() returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;
  -- agenda incrementais para integrações conectadas sem job pendente
  insert into sync_jobs (organizacao_id, integracao_id, tipo, recurso, parametros)
  select i.organizacao_id, i.id, 'incremental', r.recurso, '{}'::jsonb
    from integracoes i cross join (values ('vendas'),('contas_pagar'),('contas_receber'),('produtos')) r(recurso)
   where i.status = 'conectado'
     and not exists (select 1 from sync_jobs j where j.integracao_id = i.id and j.recurso = r.recurso and j.status in ('pendente','executando'))
     and coalesce(i.ultima_sincronizacao, '-infinity') < now() - interval '25 minutes';
  perform net.http_post(url := v_url || '/functions/v1/bling-sync',
                        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
                        body := '{}'::jsonb, timeout_milliseconds := 5000);
end $$;
revoke execute on function fn_disparar_sync() from public, anon, authenticated;

select cron.schedule('financy-rotina-diaria', '0 9 * * *', 'select public.fn_rotina_diaria()');   -- 06:00 BRT
select cron.schedule('financy-bling-sync', '*/10 * * * *', 'select public.fn_disparar_sync()');

-- Resumo/alertas semanais da IA (segunda-feira 08:00 BRT); só roda se a OpenRouter estiver configurada na função
create or replace function fn_disparar_ia_semanal() returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url || '/functions/v1/ai-assistant',
                        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
                        body := '{"acao":"alertas"}'::jsonb, timeout_milliseconds := 5000);
end $$;
revoke execute on function fn_disparar_ia_semanal() from public, anon, authenticated;
select cron.schedule('financy-ia-semanal', '0 11 * * 1', 'select public.fn_disparar_ia_semanal()');
