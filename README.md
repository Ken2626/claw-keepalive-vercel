# claw-keepalive-vercel

A minimal open-source Vercel project that exposes a protected API endpoint to perform a Claw Cloud sign-in flow via GitHub.

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## What this does

1. Val Town runs every 7 days.
2. Val Town calls Vercel `POST /api/keepalive`.
3. Vercel verifies `Authorization: Bearer <CRON_SECRET>`.
4. Vercel runs browser automation to sign in using your configured data center URL (`CLAW_SIGNIN_URL` or `CLAW_DATACENTER`).
   - Germany example: `https://eu-central-1.run.claw.cloud/signin`
5. `GITHUB_OTP_SECRET` is required, so GitHub `2FA` (TOTP) is auto-handled by Vercel.
6. If GitHub still asks `verified-device` email code, use the interactive Val (`valtown/first-login.ts`) to input the code and continue.

## Security model (important)

- Do **not** commit credentials.
- Set `CRON_SECRET`, `GITHUB_USERNAME`, `GITHUB_PASSWORD`, `GITHUB_OTP_SECRET`, and `CLAW_DATACENTER` (or `CLAW_SIGNIN_URL`) as Vercel environment variables.
- Optional: set `DEVICE_FLOW_SECRET` to encrypt one-time verification challenge tokens (fallback is `CRON_SECRET`).
- In Vercel Dashboard, create them as **Sensitive Environment Variables**.
- This repo is safe to open-source because secrets stay in Vercel/Val Town only.

## Project files

- `api/keepalive.ts`: protected API endpoint.
- `api/verify-device.ts`: continue login by submitting GitHub verification code.
- `lib/cronAuth.ts`: constant-time bearer token check.
- `lib/clawLogin.ts`: Playwright login flow.
- `valtown/main.ts`: Val Town caller example.
- `valtown/first-login.ts`: interactive first-login Val (for verified-device / manual verification code).

## Environment variables

Use `.env.example` as template:

- `CRON_SECRET` (required; API auth secret for this project, use a strong random string)
- `GITHUB_USERNAME` (required; your GitHub login account, username or email)
- `GITHUB_PASSWORD` (required; your GitHub account password)
- `GITHUB_OTP_SECRET` (required; GitHub authenticator app setup key in base32, used for auto TOTP)
- `CLAW_SIGNIN_URL` (recommended; set your own data center sign-in URL, e.g. `https://eu-central-1.run.claw.cloud/signin`)
- `CLAW_DATACENTER` (optional alternative, e.g. `us-west-1`; code builds `https://<dc>.run.claw.cloud/signin`)
- `DEVICE_FLOW_SECRET` (optional; encrypts one-time verification challenge token)

## Deploy steps

1. Fork this repository to your own GitHub account.
2. Open Vercel, sign in, import this repository, and finish the first deployment.
3. Record your project base URL: `https://<your-project>.vercel.app/`.
4. Go to `<your-project> -> Settings -> Environment Variables`.
5. Add env vars (at least `Production`; add `Preview` if needed).
6. Mark sensitive variables as **Sensitive**.
7. Save changes and redeploy when prompted.
8. Your endpoint will be:
   - `https://<your-project>.vercel.app/api/keepalive`

## Val Town setup

### A) First login (interactive, one-time when needed)

1. Open your existing Val project (the same one where you use `main.ts` for cron).
2. In that same Val project, create a new file `first-login.ts`, then paste `valtown/first-login.ts`.
3. Open `first-login.ts` and add an `HTTP trigger` from the top-right menu.
4. In Val Town env vars, set:
   - `VERCEL_URL=https://<your-project>.vercel.app/`
   - `CRON_SECRET=<same as Vercel>`
5. Open the `first-login.ts` `*.web.val.run` preview URL (not the `main.ts` cron run output), then click `Start first login`.
6. If GitHub asks `verified-device` email code, input the code on that page to finish first login.

### B) Weekly keepalive cron

1. In the same Val project, open `main.ts`, switch it to cron, and paste `valtown/main.ts`.
2. In Val Town env vars, set:
   - `VERCEL_URL=https://<your-project>.vercel.app/`
   - `CRON_SECRET=<same as Vercel>`
3. Set cron schedule to run every week in Val Town UI.

## Local type-check

```bash
npm install
npm run typecheck
```

## Notes

- This project runs Chromium inside Vercel function runtime using `@sparticuz/chromium`.
- Browser automation can break if GitHub/Claw login UI changes.
