# claw-keepalive-vercel（中文说明）

一个最小化的开源 Vercel 项目：提供受保护的 API，通过 GitHub 登录 Claw Cloud，用于定时保活。

## 功能流程

1. Val Town 每 7 天触发一次。
2. Val Town 调用 Vercel 的 `POST /api/keepalive`。
3. Vercel 校验 `Authorization: Bearer <CRON_SECRET>`。
4. Vercel 在函数内启动浏览器自动化，按你配置的数据中心登录地址进行 GitHub 登录（`CLAW_SIGNIN_URL` 或 `CLAW_DATACENTER`）。
   - 德国机房示例：`https://eu-central-1.run.claw.cloud/signin`

## 安全模型（重要）

- 不要把账号密码提交到 Git 仓库。
- 把 `CRON_SECRET`、`GITHUB_USERNAME`、`GITHUB_PASSWORD`、`CLAW_DATACENTER`（或 `CLAW_SIGNIN_URL`）存到 Vercel 环境变量中。
- 在 Vercel 控制台把这些变量标记为 **Sensitive Environment Variables**。
- 仓库可以公开，因为敏感信息只保存在 Vercel/Val Town。

## 主要文件

- `api/keepalive.ts`：受保护的 API 入口。
- `lib/cronAuth.ts`：`CRON_SECRET` 校验（常量时间比较）。
- `lib/clawLogin.ts`：Playwright 登录流程。
- `valtown/05_cron.ts`：Val Town 调用示例。

## 环境变量

参考 `.env.example`：

- `CRON_SECRET`
- `GITHUB_USERNAME`
- `GITHUB_PASSWORD`
- `GITHUB_OTP`（可选）
- `CLAW_SIGNIN_URL`（建议配置，填写你自己的数据中心登录地址）
- `CLAW_DATACENTER`（可选替代，如 `us-west-1`；代码会自动拼成 `https://<dc>.run.claw.cloud/signin`）

## 部署步骤

1. Fork 本仓库到你自己的 GitHub 账号。
2. 在 Vercel 导入该仓库。
3. 在 Vercel 配置环境变量（按需设到 `Preview`/`Production`）。
4. 把敏感变量标记为 **Sensitive**。
5. 部署完成后，接口地址为：`https://<your-project>.vercel.app/api/keepalive`

## Val Town 配置

1. 新建一个 Val，粘贴 `valtown/05_cron.ts`。
2. 在 Val Town 环境变量中设置：
   - `VERCEL_KEEPALIVE_URL=https://<your-project>.vercel.app/api/keepalive`
   - `CRON_SECRET=<与 Vercel 相同>`
3. 在 Val Town 界面里设置 Cron（`05_cron.ts` 代码本身不能自动修改计划时间）。
4. 为了避免大家都在同一时刻登录，建议为每个用户生成一个“每周随机时间”的 cron：

macOS/Linux：

```bash
SEED=$(tr -dc 'a-z0-9' </dev/urandom | head -c 16)
echo "Seed: $SEED"
H=$(printf '%s' "$SEED" | cksum | awk '{print $1}')
MIN=$((H % 60)); HOUR=$(((H / 60) % 24)); DOW=$(((H / 1440) % 7))
echo "$MIN $HOUR * * $DOW"
```

Windows PowerShell：

```powershell
$seed = -join ((48..57 + 97..122) | Get-Random -Count 16 | ForEach-Object { [char]$_ })
Write-Output "Seed: $seed"
$sha = [Security.Cryptography.SHA256Managed]::Create()
$hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))
$h = [BitConverter]::ToUInt32($hash, 0)
$min = $h % 60
$hour = [math]::Floor($h / 60) % 24
$dow = [math]::Floor($h / 1440) % 7
"$min $hour * * $dow"
```

Windows CMD（随机兜底）：

```bat
set /a min=%RANDOM% %% 60
set /a hour=%RANDOM% %% 24
set /a dow=%RANDOM% %% 7
echo %min% %hour% * * %dow%
```

- 把脚本输出的 cron（UTC）粘贴到 Val Town 的 schedule 设置里。

## 本地类型检查

```bash
npm install
npm run typecheck
```

## 说明

- 本项目在 Vercel 函数内使用 `@sparticuz/chromium` 启动 Chromium。
- GitHub/Claw 登录页面结构变更时，自动化流程可能需要调整。
