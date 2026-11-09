# 架构说明

## 1. 系统上下文（C4 · Context）

```text
   游客/店员
      │ HTTPS
      ▼
 ┌─────────────────────┐        ┌──────────────────┐
 │  Web 前端（静态）    │───────▶│  Web 网关 nginx   │
 └─────────────────────┘        └────────┬─────────┘
                                          │ /api、/inventory-api
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
             Java 订单核心          Go 余票查询           Rust 电子票验签
             （唯一写入方）        （只读、2s 缓存）      （HMAC-SHA256）
                    │                     │                     ▲
                    ▼                     └──读取──────────────┘
              PostgreSQL 17
```

**核心约定**：Java 是库存与订单的唯一写入方。Go 的缓存**只用于展示**，绝不参与是否可售的判断——这条约束是整个系统不超卖的前提，任何"顺手用缓存判断库存"的改动都会破坏一致性。

## 2. 订餐侧

Vinext/Workers 服务端渲染 + D1(SQLite) + Drizzle 版本化迁移；容器演示网关位于最外层，负责剥离外部身份头、签发访客会话、按 `ownerId` 隔离数据、对写接口做白名单与 demo 模式强制。

## 3. 关键时序

**下单（订票）**
```
Client → POST /api/orders (X-Device-Id, Idempotency-Key)
       → Controller 校验输入
       → Service @Transactional 开启
       → 按 (device_id, idempotency_key) 查重 → 命中则直接返回原单
       → 对 daily_stocks 加行锁 → 校验 capacity - reserved >= quantity
       → reserved += quantity，写订单（金额服务端计算，手机号脱敏）
       → 提交事务
       → 返回订单
定时释放：@Scheduled 每 60s 扫描 created_at < now-900s 的 UNPAID，加锁后释放
```

**核销（订票）**
```
Client → POST /api/orders/{id}/verify { ticketToken }
       → 校验订单状态 PAID、token 一致、usedAt 为空
       → 调 Rust /verify（HMAC 校验 + 游玩日期须为上海时区当日 + 数量 1–10）
       → 通过则写入 usedAt；并发下靠订单行锁保证只成功一次
```

**状态流转（订餐）**
```
new --接单--> preparing --出餐--> ready --交接--> handed_over
 │                │
 └──取消(须填原因)┴──取消(须填原因)--> cancelled
```

## 4. 故障点与降级

| 故障 | 表现 | 处理 |
|---|---|---|
| Go 余票服务不可达 | 余票展示失败 | 前端隐藏余票数字，下单仍由 Java 判定，不阻断购票 |
| Rust 验签服务超时 | 核销失败 | 拒绝核销（fail-closed），告警人工处理；不得放行为"已核销" |
| PostgreSQL 不可用 | 下单失败 | 返回 503，不写本地兜底数据；按 RUNBOOK 切换 |
| 迁移校验失败 | 服务拒绝启动 | 保持上一版本运行，禁止绕过校验强制启动 |
| 前端 WebGL 不可用 | 3D 空白 | 自动切换平面园区图 |

## 5. 目标架构建议（做减法）

当前四语言拆分对演示原型属于**过度设计**：三个额外服务带来网络失败点、部署复杂度与排障面，却没有真实并发压力支撑。若转向行业化落地，建议收敛为：

```text
一个应用服务（订单 + 验签 + 查询） + 托管 PostgreSQL + 明确 OpenAPI 契约
+ 完整可观测 + 版本化迁移 + 灰度回滚
```

保留 Go/Rust 的唯一正当理由是**确实测出了独立瓶颈**（例如余票 QPS 压垮主库、验签算力需要隔离），且必须有压测数据支撑。详见 `ADR.md` 的 ADR-001。
