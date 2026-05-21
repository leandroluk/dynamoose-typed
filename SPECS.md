1. [x] GSI query — index: true declara o GSI mas não tem como consultá-lo. Precisa de algo como repo.findByIndex('emailGlobalIndex', 'alice@x.com'). Hoje a feature está incompleta.
2. [x] Sort key conditions em find() — find(hashValue) só faz .eq(). Queries reais precisam de between, beginsWith, gt, lt no sort key. Exemplo: repo.find('userId', { sortKey: { between: ['2024-01', '2024-12'] } }).
3. [x] Filter expressions em find()/scan() — sem filtro server-side, tudo vem pro cliente. Para tabelas grandes isso é caro.
4. [x] @TtlAttribute — padrão muito comum no DynamoDB. Marca um NumberAttribute como TTL epoch e Dynamoose propaga pra timeToLive.
5. [x] findAll() — pagina automaticamente até esgotar lastKey. Hoje o consumidor tem que implementar o loop.
6. [ ] @VersionAttribute — optimistic locking via condition no update. Previne write conflicts em ambientes concorrentes.
7. [ ] LSI (localIndex: true)
8. [ ] Projection expressions (Select: SPECIFIC_ATTRIBUTES)
9. [ ] Condition expressions em writes (put only-if-not-exists, etc.)
