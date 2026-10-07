# GlueKettle-01 · 骨巷熬胶坊

一排熬锅作业台。登录后是横向锅位，点锅登记煮胶峰值并改状态。前端是原生 JS，没有 React/Vue/Svelte。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Starlette 路由表（不是 FastAPI Depends） |
| 结构 | SQLModel 实体 + `domain.py` 门槛 |
| 数据 | SQLModel / SQLAlchemy · psycopg2 · PostgreSQL 15 |
| 前端 | 原生 ES Module · Vite 仅打包 |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4790
- API：http://localhost:8790
- PostgreSQL：localhost:6190

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

- 锅不可标「已出胶」，除非最近一次煮胶峰值 **≥ 90℃**。规则在 `backend/app/domain.py`。
- 「熬煮中」拨回「冷锅」须当日有效**开闸证**；无证或当日证写「关闸」都挡住。已出胶拨冷锅、登记峰值、出胶本身都不查闸板证。
- 闸板证字段：坊、巡沟日、开闸/关闸、巡沟人、作废时刻（可空）。同坊同日有效证至多一张，由部分唯一索引（`voided_at IS NULL`）兜底并发双开；仅管理员可巡沟开证与作废。
- 种子数据：一锅熬煮中、当日一张关闸证（admin 巡）。

## 快速启动

```bash
cd GlueKettle/GlueKettle-01
docker compose up --build
```
