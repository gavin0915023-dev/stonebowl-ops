# 行业化工程基线包

针对本机两份源码（`D:\bianjing-tickets-source\bianjing-tickets`、`C:\Users\yangb\bibimbap-ops-20261105`）补齐 P1 生产就绪与 P2 工程治理层，使其从「能跑的原型」升级为「可运维、可验证、可交付」的工程。

## 边界：这个包不做什么（红线）

**P0 层不是代码能解决的，本包不伪造、不模拟、不留假接口：**

| 事项 | 为什么做不了 |
|---|---|
| 真实收款 | 需营业执照、微信/支付宝商户号、支付回调与对账、发票 |
| 真实出票与闸机核销 | 需景区或票务代理授权、核销终端、实名绑定、退改规则 |
| 美团订单接入 | 需商户授权与开放平台审核、回调验签、状态回传 |
| 面向公众上线 | 需 ICP 备案、隐私政策与用户协议、个人信息合规、行业等保 |
| 生成式 AI 对外服务 | 如引入模型能力，需完成相应备案与安全评估 |

两份原 README 已主动声明这些能力不存在。本包**只补工程层**，任何"看起来能营业"的伪装都会误导，因此一律不做。

## 已补内容

**P1 生产就绪**
- 订票：无默认值的生产配置、启动强校验（弱密钥/模拟支付/localhost 来源一律拒绝启动）、Flyway 版本化迁移替代 `ddl-auto: update`、MDC traceId 过滤器、结构化日志、OpenAPI 契约、并发压测、备份恢复演练
- 订餐：OpenAPI 契约、状态机并发压测、D1 快照备份恢复演练

**P2 工程治理**
- 需求规格与验收标准、架构说明与关键时序、4 条 ADR、部署/回滚/故障运维手册、演练记录模板
- 两份 GitHub Actions 流水线（测试、构建、契约校验、依赖扫描）
- 自检脚本 `verify.mjs`、应用脚本 `apply.mjs`

## 使用

```bash
cd C:/Users/yangb/WorkBuddy/2026-11-06-23-02-08/industrialized
node verify.mjs          # 自检交付物：结构、脚本语法、契约、弱密钥扫描
node apply.mjs --dry-run # 预览会新增哪些文件
node apply.mjs --commit  # 铺进两个原项目（只新增，绝不覆盖已有文件）
```

`apply.mjs` 的默认策略是**只新增不覆盖**：新增文件可安全落盘；需要替换既有配置的，本包以 `*.recommended` 形式提供完整内容，由人确认后手工替换。原项目已有文件不会被自动改写。

## 应用后仍需人完成的动作

1. 按 `tickets/config/application.yml.recommended` 替换原 `application.yml`，并按 `tickets/config/pom-additions.xml` 补齐依赖（`flyway-core`、`flyway-database-postgresql`、`micrometer-registry-prometheus`）。
2. 把 `tickets/db/V1__init.sql` 放到 `src/main/resources/db/migration/`，两个 Java 类放到 `src/main/java/cn/bianjing/booking/`，`logback-spring.xml` 放到 `src/main/resources/`。
3. 在 CI 仓库里启用 `ci/*.yml`，配置 secrets（数据库口令、签名密钥、STAFF_KEY）。
4. 跑一次真实并发压测与备份恢复演练，把结果填进 `docs/DRILL-RECORD.md` —— **模板里的记录是空的，不要填假数据**。
5. 按 `docs/RUNBOOK.md` 补齐监控告警接收人、值班表与故障升级路径。
6. 走 P0 的资质与平台授权流程，那一步由经营主体完成，不是工程任务。

## 诚实声明

本包不包含、也不声称包含任何真实交易、真实出票、平台对接或合规资质。所有压测与演练脚本在未启动服务时会明确报错或进入演练模式，**不产生伪造的"通过"结果**。
