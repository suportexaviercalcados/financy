-- =====================================================================
-- FINANCY — 0008 Concessão de acesso de suporte e dados de demonstração
-- =====================================================================

-- O proprietário concede acesso temporário (somente leitura) a um administrador da plataforma pelo e-mail
create or replace function fn_conceder_suporte(p_org uuid, p_email text, p_motivo text, p_dias int default 7) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_id uuid;
begin
  if not fn_is_owner(p_org) then raise exception 'Somente o proprietário pode conceder acesso de suporte.'; end if;
  select u.id into v_admin from auth.users u join platform_admins pa on pa.user_id = u.id where lower(u.email) = lower(trim(p_email));
  if v_admin is null then raise exception 'E-mail não corresponde a um administrador da plataforma.'; end if;
  if length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'Informe o motivo do acesso.'; end if;
  insert into acessos_suporte (organizacao_id, admin_user_id, concedido_por, motivo, expira_em)
  values (p_org, v_admin, auth.uid(), trim(p_motivo), now() + make_interval(days => least(greatest(p_dias,1), 30)))
  returning id into v_id;
  return v_id;
end $$;

/*
  Modo de demonstração: cria uma organização SEPARADA, marcada como demonstração, com vendas e contas fictícias
  (origem 'demo'). Nada é atribuído ao Bling ou à IA. Serve para conhecer o sistema sem credenciais externas.
*/
create or replace function fn_criar_demo() returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_emp uuid; v_banco uuid; v_caixa uuid; v_loja uuid; v_site uuid; v_whats uuid;
  f_pix uuid; f_cred uuid; f_deb uuid; f_bol uuid; d date; i int; v_tit uuid; p_tenis uuid; p_bolsa uuid; p_meia uuid; p_cinto uuid;
  ini date := (date_trunc('month', current_date) - interval '3 months')::date;
begin
  v_org := fn_criar_organizacao('Demonstração — Loja Exemplo', jsonb_build_object('razao_social','Loja Exemplo Calçados LTDA (DEMONSTRAÇÃO)',
             'nome_fantasia','Loja Exemplo (demo)','regime_tributario','simples','aliquota_imposto_vendas', 6));
  update organizacoes set nome = 'Demonstração — Loja Exemplo', onboarding_concluido = true where id = v_org;
  select id into v_emp from empresas where organizacao_id = v_org;
  insert into contas_bancarias (organizacao_id, empresa_id, nome, tipo, banco, saldo_inicial, data_saldo_inicial)
  values (v_org, v_emp, 'Banco (demo)', 'corrente', 'Banco Exemplo', 25000, ini - 1) returning id into v_banco;
  insert into contas_bancarias (organizacao_id, empresa_id, nome, tipo, saldo_inicial, data_saldo_inicial)
  values (v_org, v_emp, 'Caixa da loja (demo)', 'caixa', 800, ini - 1) returning id into v_caixa;
  insert into canais_venda (organizacao_id, nome, tipo) values (v_org, 'Loja física', 'loja_fisica') returning id into v_loja;
  insert into canais_venda (organizacao_id, nome, tipo, comissao_percentual, custo_frete_percentual) values (v_org, 'Site', 'site', 0, 4) returning id into v_site;
  insert into canais_venda (organizacao_id, nome, tipo, comissao_percentual) values (v_org, 'WhatsApp', 'whatsapp', 3) returning id into v_whats;
  select id into f_pix from formas_pagamento where organizacao_id = v_org and tipo = 'pix';
  select id into f_cred from formas_pagamento where organizacao_id = v_org and tipo = 'credito';
  select id into f_deb from formas_pagamento where organizacao_id = v_org and tipo = 'debito';
  select id into f_bol from formas_pagamento where organizacao_id = v_org and tipo = 'boleto';
  insert into canal_taxas (organizacao_id, forma_pagamento_id, conta_bancaria_id, parcelas_min, parcelas_max, taxa_percentual, prazo_dias) values
    (v_org, f_cred, v_banco, 1, 12, 3.99, 30), (v_org, f_deb, v_banco, 1, 1, 1.49, 1), (v_org, f_pix, v_banco, 1, 1, 0, 0);
  insert into produtos (organizacao_id, sku, nome, preco, custo, origem) values
    (v_org, 'TN-01', 'Tênis casual', 299.90, 128, 'demo') returning id into p_tenis;
  insert into produtos (organizacao_id, sku, nome, preco, custo, origem) values (v_org, 'BL-02', 'Bolsa couro', 349.00, 150, 'demo') returning id into p_bolsa;
  insert into produtos (organizacao_id, sku, nome, preco, custo, origem) values (v_org, 'MA-03', 'Meia kit 3', 39.90, 12, 'demo') returning id into p_meia;
  insert into produtos (organizacao_id, sku, nome, preco, custo, origem) values (v_org, 'CI-04', 'Cinto (sem custo cadastrado)', 89.90, null, 'demo') returning id into p_cinto;
  -- vendas determinísticas em 3 meses + mês atual
  d := ini; i := 0;
  while d <= current_date loop
    i := i + 1;
    perform fn_registrar_venda(jsonb_build_object('organizacao_id', v_org, 'empresa_id', v_emp, 'data_venda', d, 'origem', 'demo', 'external_id', 'demo-' || i,
      'canal_id', case i % 3 when 0 then v_site when 1 then v_loja else v_whats end,
      'itens', jsonb_build_array(
        jsonb_build_object('produto_id', p_tenis, 'descricao', 'Tênis casual', 'quantidade', 1 + i % 2, 'preco_unitario', 299.90),
        jsonb_build_object('produto_id', case when i % 5 = 0 then p_cinto else p_meia end, 'descricao', 'Acessório', 'quantidade', 1, 'preco_unitario', case when i % 5 = 0 then 89.90 else 39.90 end)),
      'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', case i % 4 when 0 then f_pix when 1 then f_cred when 2 then f_deb else f_cred end,
        'parcelas', case when i % 4 = 1 then 3 else 1 end,
        'valor', (1 + i % 2) * 299.90 + case when i % 5 = 0 then 89.90 else 39.90 end))));
    d := d + 1;
  end loop;
  -- despesas fixas e compras (mensais), as passadas já pagas
  for i in 0..3 loop
    d := (ini + make_interval(months => i))::date;
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, categoria_id, valor, data_emissao, data_vencimento, data_competencia, origem, external_id)
    select v_org, v_emp, 'pagar', x.descr, (select id from plano_contas where organizacao_id = v_org and codigo = x.cod), x.valor, d, d + x.dia, d, 'demo', 'demo-' || x.cod || '-' || i
      from (values ('Aluguel da loja', '5.2.1', 1800.00, 9), ('Salários', '5.1.1', 2800.00, 4), ('Energia e internet', '5.2.2', 640.00, 14),
                   ('Sistema e assinaturas', '5.3.2', 290.00, 19), ('Anúncios', '5.4.1', 400.00, 24), ('Compra de mercadorias', '3.2', 5500.00, 27)) x(descr, cod, valor, dia);
  end loop;
  for v_tit in select id from titulos where organizacao_id = v_org and origem = 'demo' and status = 'aberto' and data_vencimento < current_date loop
    perform fn_baixar_titulo(v_tit, v_banco, (select data_vencimento from titulos where id = v_tit), (select valor from titulos where id = v_tit));
  end loop;
  for v_tit in select id from titulos where organizacao_id = v_org and origem = 'venda' and status = 'aberto' and data_vencimento < current_date loop
    perform fn_baixar_titulo(v_tit, v_banco, (select data_vencimento from titulos where id = v_tit), (select valor from titulos where id = v_tit));
  end loop;
  insert into metas (organizacao_id, empresa_id, competencia, valor) values (v_org, v_emp, date_trunc('month', current_date)::date, 12000);
  insert into alertas (organizacao_id, tipo, severidade, titulo, mensagem, chave)
  values (v_org, 'demo', 'info', 'Organização de demonstração', 'Todos os dados desta organização são fictícios (origem "demo"). Nada foi importado do Bling nem gerado pela IA.', 'demo');
  perform fn_gerar_alertas(v_org);
  return v_org;
end $$;
