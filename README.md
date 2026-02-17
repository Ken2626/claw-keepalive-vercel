# claw-keepalive-vercel

A minimal open-source Vercel project that exposes a protected API endpoint to perform a Claw Cloud sign-in flow via GitHub.

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## What this does

1. Val Town runs every 7 days.
2. Val Town calls Vercel `POST /api/keepalive`.
3. Vercel verifies `Authorization: Bearer <CRON_SECRET>`.
4. Vercel runs browser automation to sign in using your configured data center URL (`CLAW_SIGNIN_URL` or `CLAW_DATACENTER`).
   - Germany example: `https://eu-central-1.run.claw.cloud/signin`

## Security model (important)

- Do **not** commit credentials.
- Set `CRON_SECRET`, `GITHUB_USERNAME`, `GITHUB_PASSWORD`, and `CLAW_DATACENTER` (or `CLAW_SIGNIN_URL`) as Vercel environment variables.
- In Vercel Dashboard, create them as **Sensitive Environment Variables**.
- This repo is safe to open-source because secrets stay in Vercel/Val Town only.

## Project files

- `api/keepalive.ts`: protected API endpoint.
- `lib/cronAuth.ts`: constant-time bearer token check.
- `lib/clawLogin.ts`: Playwright login flow.
- `valtown/05_cron.ts`: Val Town caller example.

## Environment variables

Use `.env.example` as template:

- `CRON_SECRET`
- `GITHUB_USERNAME`
- `GITHUB_PASSWORD`
- `GITHUB_OTP` (optional)
- `CLAW_SIGNIN_URL` (recommended; set your own data center sign-in URL)
- `CLAW_DATACENTER` (optional alternative, e.g. `us-west-1`; code builds `https://<dc>.run.claw.cloud/signin`)

## Deploy steps

1. Fork this repository to your own GitHub account.
2. Import repository in Vercel.
3. Add all env vars in Vercel (`Preview` + `Production` as needed).
4. Mark secrets as **Sensitive** in Vercel.
5. Deploy.
6. Your endpoint will be:
   - `https://<your-project>.vercel.app/api/keepalive`

## Val Town setup

1. Create a new Val and paste `valtown/05_cron.ts`.
2. In Val Town env vars, set:
   - `VERCEL_KEEPALIVE_URL=https://<your-project>.vercel.app/api/keepalive`
   - `CRON_SECRET=<same as Vercel>`
3. Set schedule in Val Town UI (it cannot be auto-set by code in `05_cron.ts`).
4. To avoid everyone using the same time, generate a per-user weekly cron:

macOS/Linux:

```bash
SEED=$(tr -dc 'a-z0-9' </dev/urandom | head -c 16)
echo "Seed: $SEED"
H=$(printf '%s' "$SEED" | cksum | awk '{print $1}')
MIN=$((H % 60)); HOUR=$(((H / 60) % 24)); DOW=$(((H / 1440) % 7))
echo "$MIN $HOUR * * $DOW"
```

Windows PowerShell:

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

Windows CMD (random fallback):

```bat
set /a min=%RANDOM% %% 60
set /a hour=%RANDOM% %% 24
set /a dow=%RANDOM% %% 7
echo %min% %hour% * * %dow%
```

- Copy the generated cron string (UTC) into Val Town schedule settings.

## Local type-check

```bash
npm install
npm run typecheck
```

## Notes

- This project runs Chromium inside Vercel function runtime using `@sparticuz/chromium`.
- Browser automation can break if GitHub/Claw login UI changes.
