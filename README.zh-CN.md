# claw-keepalive-vercel（中文说明）

一个最小化的开源 Vercel 项目：提供受保护的 API，通过 GitHub 登录 Claw Cloud，用于定时保活。

## 功能流程

1. Val Town 每 7 天触发一次。
2. Val Town 调用 Vercel 的 `POST /api/keepalive`。
3. Vercel 校验 `Authorization: Bearer <CRON_SECRET>`。
4. Vercel 在函数内启动浏览器自动化，按你配置的机房登录地址进行 GitHub 登录（`CLAW_SIGNIN_URL` 或 `CLAW_DATACENTER`）。
   - 德国机房示例：`https://eu-central-1.run.claw.cloud/signin`
5. 必须开启 GitHub `2FA`（Authenticator），并配置 `GITHUB_OTP_SECRET`，这样 Vercel 才能自动处理 TOTP 验证码。

## 安全模型（重要）

- 不要把账号密码提交到 Git 仓库。
- 把 `CRON_SECRET`、`GITHUB_USERNAME`、`GITHUB_PASSWORD`、`GITHUB_OTP_SECRET`、`CLAW_DATACENTER`（或 `CLAW_SIGNIN_URL`）存到 Vercel 环境变量中。
- 在 Vercel 控制台把这些变量标记为 **Sensitive Environment Variables**。
- 仓库可以公开，因为敏感信息只保存在 Vercel/Val Town。

## 主要文件

- `api/keepalive.ts`：受保护的 API 入口。
- `lib/cronAuth.ts`：`CRON_SECRET` 校验（常量时间比较）。
- `lib/clawLogin.ts`：Playwright 登录流程。
- `valtown/main.ts`：Val Town 调用示例。

## 环境变量

参考 `.env.example`：

- `CRON_SECRET`（必须配置；本项目 API 鉴权密钥，建议使用高强度随机字符串）
- `GITHUB_USERNAME`（必须配置；你的 GitHub 登录账号，可用用户名或邮箱）
- `GITHUB_PASSWORD`（必须配置；你的 GitHub 账号密码）
- `GITHUB_OTP_SECRET`（必须配置；GitHub Authenticator 的 base32 setup key，用于自动生成 TOTP）
- `CLAW_SIGNIN_URL`（建议配置；填写你自己的机房登录地址。德国机房示例：`https://eu-central-1.run.claw.cloud/signin`）
- `CLAW_DATACENTER`（可选替代，如 `us-west-1`；代码会自动拼成 `https://<dc>.run.claw.cloud/signin`）

## GitHub 2FA 配置（必须）

1. 在 GitHub 打开 `Settings -> Password and authentication -> Two-factor authentication`，选择 `Authenticator app`。
2. 在出现二维码和 setup key 的页面，先点击显示 setup key（找这一句话:Unable to scan? You can use the setup key to manually configure your authenticator app.），把setup key复制并保存为 `GITHUB_OTP_SECRET`。
3. 完成后再扫码绑定认证器(推荐使用Google Authenticator的APP)并完成 GitHub 验证。
4. 将 `GITHUB_OTP_SECRET` 配置到 Vercel 环境变量（标记为 **Sensitive**）。

## 部署步骤

1. Fork 本仓库到你自己的 GitHub 账号。
2. 打开 Vercel 并登录，在 Vercel 导入该仓库并完成首次部署，记录项目地址：`https://<your-project>.vercel.app/`
3. 进入 `<your-project> -> Settings -> Environment Variables`，配置环境变量（建议配置到 `Production`，按需再加 `Preview`）。
4. 把敏感变量标记为 **Sensitive**。
5. 保存环境变量，并按提示重新部署（Redeploy）。
6. 继续下一步 Val Town 配置。

## Val Town 配置

每周保活（cron）

1. 在同一个 Val 项目中打开 `main.ts`，切换为 cron，然后粘贴 `valtown/main.ts`。
2. 在 Val Town 环境变量中设置：
   - `VERCEL_URL=https://<your-project>.vercel.app/`
   - `CRON_SECRET=<与 Vercel 相同>`
3. 在 Val Town 界面把 cron schedule 设置为每周运行一次。

## 本地类型检查

```bash
npm install
npm run typecheck
```

## 说明

- 本项目在 Vercel 函数内使用 `@sparticuz/chromium` 启动 Chromium。
- GitHub/Claw 登录页面结构变更时，自动化流程可能需要调整。
