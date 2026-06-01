# NSE RS Scanner

Professional **Relative Strength + Technical Scanner** for the full NSE universe (380+ stocks).

**Features**
- Full NSE scan with **RSI(14)**, **50 EMA**, distance to EMA, 3M/6M returns, **Relative Strength vs Nifty**
- Beautiful fast table with filters: Above EMA50, RSI ≥50, Outperforming Nifty (positive RS)
- **Personal Watchlist** that persists across logins (Google or Email magic links)
- Add any ticker (even ones not in the main list)
- CSV export, detail modals, progress during scan
- Powered by Yahoo Finance (real data)

Deployed easily on Vercel.

## Tech Stack
- Next.js 16 (App Router) + TypeScript + Tailwind
- yahoo-finance2
- Supabase (Auth + Postgres for watchlist)
- framer-motion, sonner, lucide-react

## 1. Create a Supabase Project (5 mins)

1. Go to https://supabase.com and create a new project (free tier is perfect).
2. Once created, go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Go to **SQL Editor** and run this to create the watchlist table + RLS policies:

```sql
create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  symbol text not null,
  created_at timestamptz default now(),
  unique (user_id, symbol)
);

alter table public.watchlist_items enable row level security;

create policy "Users can view own watchlist"
  on public.watchlist_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own items"
  on public.watchlist_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own items"
  on public.watchlist_items for delete
  using (auth.uid() = user_id);
```

## 2. Enable Authentication Providers

### Google (recommended)
1. In Supabase: **Authentication → Providers → Google** → Enable
2. You need a Google OAuth Client ID + Secret:
   - Go to https://console.cloud.google.com/apis/credentials
   - Create OAuth 2.0 Client ID (Web application)
   - Authorized redirect URI: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`
3. Paste the Client ID / Secret into Supabase Google provider.

### Email (magic links)
Already enabled by default. Users enter email → receive a one-click link. No password needed.

## 3. Deploy to Vercel

### Option A — One-click (recommended)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyourname%2Fnse-rs-scanner)

### Option B — Manual
1. Push this folder to a GitHub repo.
2. Import the repo in Vercel.
3. Add the two environment variables from step 1:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Done.

After first deploy, you can add a custom domain anytime.

## 4. Local Development

```bash
npm install
cp .env.example .env.local
# Paste your Supabase keys into .env.local
npm run dev
```

Visit http://localhost:3000

## How the Scanner Works

- Clicks "SCAN ALL STOCKS" → analyzes ~380 liquid NSE stocks using Yahoo daily history.
- Computes:
  - RSI(14) (Wilder)
  - 50-period EMA
  - 3-month & 6-month returns
  - Relative Strength = Stock 3M return − Nifty 50 3M return
- Results are cached server-side for ~3 minutes.
- Star any stock (requires login) → saved in your private Supabase row.
- Watchlist loads instantly on future visits.

## Tips & Limitations

- First full scan takes 4–8 minutes (Yahoo rate limits). Subsequent views are instant thanks to cache.
- You can add any valid `.NS` ticker manually in the Watchlist tab (e.g. `IRFC`, `ZOMATO`).
- Data is delayed (Yahoo free tier). Not for live trading decisions.
- For production email sending (magic links), configure a custom SMTP or Resend in Supabase Auth settings.

## Project Structure

```
app/
  api/analyze/          # Yahoo + indicator computation
  auth/callback/        # OAuth / magic link handler
  layout.tsx
  page.tsx              # The entire beautiful SPA
components/SignInModal.tsx
lib/
  analyzer.ts           # RSI, EMA, return calculations
  symbols.ts            # 380+ NSE tickers (curated)
  supabase/
    client.ts
    server.ts
  utils.ts
```

## Credits & Similar Tools

This app follows the same high-quality UI/UX and data patterns as the other NSE scanners in this workspace (60EMA, Volume Surge, etc.).

Built for traders who want fast technical scans + a personal persistent list.

---

**Not financial advice.** Always do your own research. Markets involve risk.
