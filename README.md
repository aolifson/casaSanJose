# Casa San Jose — Delivery Route Planner

A web app for optimizing food delivery routes for Casa San Jose volunteers in Pittsburgh, PA.

## Features

- **Coordinator Mode** — Upload a CSV or XML file of delivery addresses, add volunteers with their home address and number of stops, and generate optimized routes for all volunteers at once.
- **Volunteer Mode** — Enter your home address and assigned delivery addresses to get your personalized, optimized route.
- Interactive Google Maps with numbered stop markers
- One-click "Open in Google Maps" and route link copy button
- Addresses saved locally so you don't retype them each session

---

## Setup

### 1. Get a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library** and enable:
   - Maps JavaScript API
   - Places API
   - Directions API
   - Distance Matrix API
   - Geocoding API
4. Go to **APIs & Services → Credentials → Create Credentials → API Key**
5. Copy your API key

> **Tip:** Restrict your key to your website's domain in production (Credentials → Edit → API restrictions).

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure API Key

**Option A — Environment variable (recommended for deployment):**

```bash
cp .env.example .env
# Edit .env and add your key:
# VITE_GOOGLE_MAPS_API_KEY=AIza...
```

**Option B — In-app input:**

If no `.env` key is set, the app will prompt you to paste your API key on first load. It's stored in your browser's local storage.

### 4. Run Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deployment

This is a pure static site — no server required.

### Build

```bash
npm run build
# Output is in the dist/ folder
```

### Deploy to Netlify

1. Connect your repo to [Netlify](https://netlify.com)
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Add environment variable: `VITE_GOOGLE_MAPS_API_KEY=AIza...`

### Deploy to Vercel

1. Import your repo at [Vercel](https://vercel.com)
2. Framework: Vite
3. Add environment variable: `VITE_GOOGLE_MAPS_API_KEY=AIza...`

### Deploy to GitHub Pages

```bash
npm run build
# Push the dist/ folder to your gh-pages branch
```

---

## File Upload Formats

### CSV

Single address column:
```
address
123 Main St, Pittsburgh, PA 15216
456 Oak Ave, Pittsburgh, PA 15217
```

Multi-column:
```
street,city,state,zip
123 Main St,Pittsburgh,PA,15216
456 Oak Ave,Pittsburgh,PA,15217
```

### XML

```xml
<deliveries>
  <delivery>
    <address>123 Main St, Pittsburgh, PA 15216</address>
  </delivery>
  <delivery>
    <address>456 Oak Ave, Pittsburgh, PA 15217</address>
  </delivery>
</deliveries>
```

---

## Limits

| Constraint | Value |
|---|---|
| Max deliveries per volunteer | 23 |
| Max addresses in coordinator pool | 150 |
| Distance matrix pool (coordinator mode) | 100 (for API quota safety) |

---

## Future: Mobile App (Capacitor)

The app is built to be hybrid-app-ready. When you're ready to publish to iOS/Android:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "Casa San Jose Routes" "org.casasanjose.routes" --web-dir dist
npm run build
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios      # Opens Xcode
npx cap open android  # Opens Android Studio
```

No code changes are required — the web app runs inside a native WebView.
