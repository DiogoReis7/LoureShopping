# Investigar e eliminar o erro "stack depth limit exceeded" ao registar vendas

## Situação atual (verificada agora)

Depois da reversão, verifiquei a base de dados e **não encontrei nada recursivo**:

- As regras de acesso às vendas dependem apenas da tabela de escalas (baixa médica) e da função de administrador — e as regras da tabela de escalas não voltam a apontar para as vendas. Não há ciclo entre elas.
- Os automatismos ligados às vendas são apenas dois: atualizar a data de alteração e escrever no registo de atividade. O registo de atividade não tem automatismos próprios, por isso não se auto-alimenta.

Ou seja, o problema não está no estado atual da base de dados: veio da versão que reverteste. **A causa exata ainda não está confirmada** — confirmá-la é o primeiro passo do plano, e não vou alterar nada antes disso.

## Hipótese principal

O erro é da base de dados e aparece quando um pedido é grande ou profundo demais para ser interpretado — por exemplo, uma consulta construída com centenas de condições encadeadas (listas enormes de colaboradores/produtos/datas juntas num só pedido), ou uma gravação em lote muito grande. As páginas novas que estavam a ser feitas (banner de desafios no PDS) juntavam mais consultas ao mesmo ecrã, o que encaixa com "acontecia em vários sítios".

## Passos

1. **Reproduzir e confirmar**
   - Registar uma venda pelo PDS, pelo individual e pelo contador, com sessão real, e observar os pedidos que a app faz ao servidor no momento do erro.
   - Identificar o pedido concreto que devolve o erro e o seu tamanho (quantas condições/linhas leva).

2. **Corrigir a causa confirmada**
   - Se for um pedido demasiado grande: dividir em pedidos mais pequenos (blocos) e simplificar os filtros, usando intervalos de datas em vez de listas longas.
   - Se for uma gravação em lote: gravar por lotes limitados.
   - Se a investigação revelar outra causa (por exemplo uma regra de acesso reintroduzida pela versão nova), corrigi-la nesse ponto.

3. **Proteger para não voltar**
   - Limitar o tamanho dos pedidos de vendas num único ponto partilhado do código, para que qualquer ecrã fique protegido.
   - Mostrar uma mensagem clara ao utilizador se uma gravação falhar, em vez de erro técnico.

4. **Validar**
   - Registar vendas nos três ecrãs e confirmar que gravam sem erro.
   - Confirmar que os totais, rankings e o painel COMBINA continuam corretos.

## Notas técnicas

- Erro Postgres `54001 stack depth limit exceeded`, tipicamente provocado por expressões `or=(...)`/`in=(...)` muito extensas via PostgREST, ou por recursão em políticas RLS/triggers.
- Estado verificado: políticas de `sales_entries` referenciam `shift_days` (políticas `true`, sem retorno a `sales_entries`); triggers em `sales_entries` são `set_updated_at` e `log_activity`; `activity_log` sem triggers.
- Correções ficarão nos pontos de leitura/escrita de `sales_entries` (PDS, individual, contador) e num utilitário partilhado para dividir filtros em blocos.
- O banner de desafios no PDS fica de fora deste plano, conforme pedido.
