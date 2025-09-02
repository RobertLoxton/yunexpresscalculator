# Packaging Box Designer (Next.js + Tailwind)

## Local dev
```bash
npm i
npm run dev
# open http://localhost:3000
```

## Deploy to Vercel
1) Push this folder to a new GitHub repo.
2) In Vercel, **Import Project** → select the repo.
3) Framework: **Next.js** (auto-sets `Build Command: next build` and `Output Directory: .next`).
4) Deploy.

## Notes
- The app is a Client Component (uses `'use client'`).
- React Three Fiber / Drei are dynamically imported only when WebGL is available; otherwise an SVG preview is shown.
- You can download JSON/CSV/Preview from the header buttons.
