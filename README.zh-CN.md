# claw-keepalive-vercel（中文说明）

一个最小化的开源 Vercel 项目：提供受保护的 API，通过 GitHub 登录 Claw Cloud，用于定时保活。

## 功能流程

1. Val Town 每 7 天触发一次。
2. Val Town 调用 Vercel 的 `POST /api/keepalive`。
3. Vercel 校验 `Authorization: Bearer <CRON_SECRET>`。
4. Vercel 在函数内启动浏览器自动化，按你配置的机房登录地址进行 GitHub 登录（`CLAW_SIGNIN_URL` 或 `CLAW_DATACENTER`）。
   - 德国机房示例：`https://eu-central-1.run.claw.cloud/signin`
5. 如果首次登录遇到 GitHub `2FA` 或 `verified-device`，用交互式 Val（`valtown/first-login.ts`）输入验证码并完成登录。

## 安全模型（重要）

- 不要把账号密码提交到 Git 仓库。
- 把 `CRON_SECRET`、`GITHUB_USERNAME`、`GITHUB_PASSWORD`、`CLAW_DATACENTER`（或 `CLAW_SIGNIN_URL`）存到 Vercel 环境变量中。
- 可选配置 `DEVICE_FLOW_SECRET`，用于加密一次性验证码挑战令牌（不填则回退使用 `CRON_SECRET`）。
- 在 Vercel 控制台把这些变量标记为 **Sensitive Environment Variables**。
- 仓库可以公开，因为敏感信息只保存在 Vercel/Val Town。

## 主要文件

- `api/keepalive.ts`：受保护的 API 入口。
- `api/verify-device.ts`：提交 GitHub 验证码后继续登录。
- `lib/cronAuth.ts`：`CRON_SECRET` 校验（常量时间比较）。
- `lib/clawLogin.ts`：Playwright 登录流程。
- `valtown/main.ts`：Val Town 调用示例。
- `valtown/first-login.ts`：首次登录交互式 Val（用于 2FA / 邮件验证码）。

## 环境变量

参考 `.env.example`：

- `CRON_SECRET`（必须配置；本项目 API 鉴权密钥，建议使用高强度随机字符串）
- `GITHUB_USERNAME`（必须配置；你的 GitHub 登录账号，可用用户名或邮箱）
- `GITHUB_PASSWORD`（必须配置；你的 GitHub 账号密码）
- `CLAW_SIGNIN_URL`（建议配置；填写你自己的机房登录地址。德国机房示例：`https://eu-central-1.run.claw.cloud/signin`）
- `CLAW_DATACENTER`（可选替代，如 `us-west-1`；代码会自动拼成 `https://<dc>.run.claw.cloud/signin`）
- `DEVICE_FLOW_SECRET`（可选，用于加密挑战令牌）
- `GITHUB_OTP`（可选）

## 部署步骤

1. Fork 本仓库到你自己的 GitHub 账号。
2. 打开 Vercel 并登录，在 Vercel 导入该仓库并完成首次部署，记录项目地址：`https://<your-project>.vercel.app/`
3. 进入 `<your-project> -> Settings -> Environment Variables`，配置环境变量（至少配置到 `Production`，按需再加 `Preview`）。
4. 把敏感变量标记为 **Sensitive**。
5. 保存环境变量，并按提示重新部署（Redeploy）。
6. 继续下一步 Val Town 配置。

## Val Town 配置

### A) 首次登录（交互式，按需一次）

1. 登录 val.town，新建一个 Val 项目。
2. 在该 Val 项目里新建 `first-login.ts` 文件，然后粘贴 `valtown/first-login.ts`。
3. 在 Val Town 环境变量中设置：
   - `VERCEL_URL=https://<your-project>.vercel.app/`
   - `CRON_SECRET=<与 Vercel 相同>`
4. 浏览器打开 `first-login.ts` 的 Web URL，点击 `Start first login`。
5. 如果 GitHub 要求 `2FA` 或 `verified-device` 邮件验证码，在页面输入验证码即可继续并完成首次登录。

### B) 每周保活（cron）

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
