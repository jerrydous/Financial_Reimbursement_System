# 服务器部署

这套编排和本机的 `docker compose up` 分开。数据库、登录、对象存储和审批队列只在内部网络里，机器上只开放网站入口。浏览器、接口和登录使用同一个 `PUBLIC_ORIGIN`，不再写死 `localhost`。

需要服务器上有 Docker，以及 Compose 插件。

## 第一次启动

在仓库根目录：

```bash
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`：

- 只有 IP 时，`PUBLIC_ORIGIN=http://你的公网IP`，`CADDY_SITE=:80`。安全组放行 80。
- 有域名时，`PUBLIC_ORIGIN=https://你的域名`，`CADDY_SITE=你的域名`。把域名解析到这台机器，并放行 80 和 443。证书由入口自动申请。
- `PUBLIC_ORIGIN` 不要以斜杠结尾。
- 把数据库口令、对象存储口令、`INTERNAL_TOKEN` 和管理员口令换成只有你知道的值。

然后构建并启动：

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

打开 `PUBLIC_ORIGIN`。初始账号的口令与用户名相同：`employee1`、`manager1`、`finance1`、`cashier1`。

登录管理台是 `PUBLIC_ORIGIN/auth/admin`，管理员来自 `KEYCLOAK_ADMIN` 和 `KEYCLOAK_ADMIN_PASSWORD`。把这四个业务账号的口令改掉。

示例公司和账号写入成功后，把 `SEED_ON_START` 改成 `false`，再执行一次 `docker compose -f deploy/docker-compose.yml up -d`。否则每次 API 重启都会把公司名称写回「示例公司」。

改 `PUBLIC_ORIGIN` 后要重新构建网页，因为登录地址和接口地址打进了页面：

```bash
docker compose -f deploy/docker-compose.yml up -d --build web
```

## 和本机编排的差别

- 网页在 `/`，接口在 `/api`，登录在 `/auth`。
- Keycloak 使用正式启动，并把数据放在 PostgreSQL，不再用开发模式的内嵌库。
- 容器里的 API 用内网地址读取登录公钥，令牌里的签发者仍是公网地址。
- 种子数据可以关掉。本机那份 `docker-compose.yml` 不受影响。
