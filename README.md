# 📸 Photo Booth

A browser photo booth: hit start, the booth counts you down, fires four shots, and prints a
downloadable strip. Shoot alone, or open a **collaborative booth** and shoot with someone else in
real time — two cameras, one countdown, both faces on the same strip.

Solo sessions never leave your browser. Shared sessions send photos straight to the other person
peer-to-peer where the networks allow it, and fall back to relaying through your own server where
they don't — so a shared booth works on any connection, with nothing to sign up for.

## Run it

```bash
npm install
npm run dev
```

That starts two things: the Vite app on `http://localhost:5173` and the signaling server on `:8787`.
Vite proxies `/rtc` to it, so the app only ever talks to its own origin.

```bash
npm run build    # typecheck + production bundle into dist/
npm run preview  # serve the built bundle
npm test         # protocol + signaling server tests
```

The camera only works on `localhost` or over HTTPS — that's a browser rule, not an app one.

## What's in it

- **Real booth sequence** — 3s or 5s countdown per shot, shutter flash, the frame freezes while it
  "develops", then the next one loads. 3 or 4 shots.
- **Collaborative shots** — invite someone by link and you both shoot on the same countdown. See
  [below](#collaborative-shots).
- **7 filters** — Classic, Noir, Sepia, Faded, Bubblegum, Frost, Flare. Applied live to the preview
  and baked into the export.
- **6 frame colours**, strip / grid / duo layouts, a handwritten caption, date stamp, optional film
  grain.
- **Download / share** — 2× resolution PNG. On mobile the Share button hands the file straight to
  the system share sheet.
- **Synthesised sound** — countdown ticks and a shutter click built from oscillators, no audio
  files. Toggleable.
- **No camera? No problem** — "Use photos instead" builds a strip from images on disk, centre-cropped
  to the same 4:3 frame.
- Responsive from a narrow phone up to a wide desktop, and respects `prefers-reduced-motion`.

## Collaborative shots

**The flow.** Hit `Collaborative shots` → **Invite someone** → you get a six-character booth code and
a link. Send it. They open it, the dialog comes up pre-filled, they hit **Step into the booth** —
and the stage splits in two: your camera on the left, theirs on the right, live.

Only the host can start the countdown. When they do, both booths count down together, both shutters
fire at the same moment, and each side sends its photo to the other. One countdown becomes one row
of the strip: **host on the left, guest on the right**. Four shots make an eight-photo duo strip,
and both people download the identical image.

Filter, frame, caption and grain stay in sync while you fiddle with them, so neither person ends up
with a different-looking strip.

**How it connects.** `server/index.js` is a small WebSocket server that puts two browsers in a room
and forwards their WebRTC handshake. When the direct link succeeds it drops out of the loop
entirely; when it can't, it forwards the session itself as `relay` frames. Either way it stores
nothing — rooms hold two sockets and no content.

Photos are ~300KB, well over the ~256KB SCTP message ceiling, so they go across in 16KB chunks with
backpressure and get reassembled on the other side.

**Testing it locally.** Two tabs on `localhost` is the quickest check — invite in one, paste the link
into the other. Both tabs need camera permission.

**Testing across devices.** `localhost` is the only host browsers trust without HTTPS, so a plain
`--host` LAN address will not get a camera. Put an HTTPS tunnel in front of it:

```bash
npm run dev
npx cloudflared tunnel --url http://localhost:5173   # or ngrok http 5173
```

Then open the tunnel URL — the invite link is built from whatever URL you are on, so it just works.

**It always connects.** A direct browser-to-browser link is only possible when at least one side's
NAT is permissive. Behind symmetric NAT — most mobile carriers, ISPs doing CGNAT, most corporate
wifi — neither browser can find a route to the other. So the booth tries three transports in order
and falls back on its own:

| | Transport | When | Partner preview |
|---|---|---|---|
| 1 | **WebRTC direct** | Same wifi, or a permissive NAT | Live video |
| 2 | **WebRTC via TURN** | Only if `VITE_TURN_*` is set — optional | Live video |
| 3 | **WebSocket relay** | Always works | ~6fps stills |

Tier 3 is the important one: the session rides the signaling socket both browsers are *already*
connected to. **If the page loads, the booth works** — no accounts, no credentials, no setup. The
countdown and the photos go through your own server, and the printed strip is byte-identical on all
three tiers. Only the liveness of your partner's preview changes.

It gives the direct route a fair shot first — one ICE restart, then a 12-second timeout — before
falling back, and logs which transport won:

```
[booth] ICE candidates gathered: {host: 4, srflx: 2, relay: 0} TURN configured: false
[booth] transport: relay — no direct route between these networks
```

Tier 2 is a pure optimisation for anyone who wants full-quality video on a hostile network: copy
`.env.example` to `.env.local`, fill in the three `VITE_TURN_*` values from any TURN provider, and
run `npm run turn:check` to confirm they work before trusting them. Note there is no longer a
working credential-free public TURN server — the old openrelay endpoints are dead — which is exactly
why tier 3 exists.

On privacy: tiers 1 and 2 never let a photo touch the app's server. Tier 3 does route photos through
it — but that is *your* server, the one you're already running, not a third party.

## Deploying

Two pieces: static files and one small Node process.

1. `npm run build` → serve `dist/` from any static host.
2. `npm start` → runs the signaling server (honours `PORT`).
3. Point `/rtc` on your web host at that process, with WebSocket upgrades passed through.

If you would rather host signaling somewhere else entirely, skip step 3 and set
`VITE_SIGNAL_URL=wss://your-server/rtc` at build time.

**Vercel + Render.** Vercel can't hold a WebSocket open, so the signaling server runs on Render:

1. On Render: New → Blueprint → pick this repo. `render.yaml` sets up a free web service.
   Check `https://<service>.onrender.com/health` returns `{"ok":true,...}`.
2. On Vercel: add `VITE_SIGNAL_URL=wss://<service>.onrender.com/rtc` and **redeploy**. Vite bakes
   env vars in at build time.

Render's free tier sleeps after ~15 idle minutes. The server pings its own public `/health` every
10 minutes (only when Render's `RENDER_EXTERNAL_URL` is set), which keeps it awake, and the app
also pings it whenever the collaborative dialog opens.

## How it's put together

```
server/
  index.js                 signaling: rooms of two, relays the WebRTC handshake
test/
  protocol.test.mts        chunking, invite codes, slot assignment
  signal.test.mjs          pairing, relay, guard rails, disconnects
src/
  App.tsx                  session state, the capture loop, duo orchestration
  components/
    booth-backdrop.tsx     velvet curtains, stage light, grain
    camera-stage.tsx       video preview, countdown, flash, split duo stage
    duo-dialog.tsx         invite / join flow
    marquee-frame.tsx      the lightbulb-studded booth frame
    photo-strip.tsx        on-screen strip
    controls.tsx           panel / segmented / swatch / toggle primitives
    ui/button.tsx          shadcn-style button
  hooks/
    use-camera.ts          getUserMedia lifecycle, facing mode, frame capture
    use-duo.ts             signaling socket, peer connection, chunked photo transfer
    use-sound.ts           Web Audio booth SFX
  lib/
    photobooth.ts          filters, themes, layout metrics
    duo-protocol.ts        wire format, booth codes, slot assignment
    render-strip.ts        canvas exporter
    image-filter.ts        pixel-level CSS filter fallback
```

The one non-obvious bit: **preview and export share one set of numbers.** `lib/photobooth.ts` holds
every measurement in "design space" (a strip is 620px wide). The DOM preview converts those to
container query units (`cqw`) so it scales to any width; the canvas exporter multiplies them by
`scale`. Change a padding value once and both follow.

Shots are stored unfiltered — the filter is applied at render time, so switching filters after a
session re-styles the strip you already shot instead of forcing a reshoot.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · WebRTC · `ws` · lucide-react · shadcn-style
components (CVA + tailwind-merge)
