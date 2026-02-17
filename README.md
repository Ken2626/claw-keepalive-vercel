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
- `valtown/main.ts`: Val Town caller example.

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
2. Open Vercel and sign in. Go to `My Team -> Settings -> Environment Variables`.
3. Add all env vars in Vercel (`Preview` + `Production` as needed).
4. Mark secrets as **Sensitive** in Vercel.
5. Import repository in Vercel.
6. Deploy.
7. Your endpoint will be:
   - `https://<your-project>.vercel.app/api/keepalive`

## Val Town setup

1. Log in to val.town, create a new Val, set it to private, open and edit `main.ts`, switch type to cron, and paste `valtown/main.ts`.
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
