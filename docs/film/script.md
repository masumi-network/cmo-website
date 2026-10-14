# One Day in Cuso's City (film script)

A 52 second pop cut of the 3D city. It opens like the macOS aerial screen saver: a drone low over the Pacific, through the fog, up over the Golden Gate. On the drop it cuts to Cuso, then runs through his day, from 06:00 to 06:00 the next morning, one place per beat.

Last updated: 2026-10-14

## Format

- 16:9 master: 3840 x 2160, 24 fps, motion blur (180 degree shutter). Social cut: 9:16, 1080 x 1920.
- Every frame is rendered from the live scene, so the film always matches the site.
- Hard cuts on the beat. Fade in from black at the start, fade out at the end.
- Titles use the site type (Geist, Geist Mono) and the four colors: paper text on the scene, Cuso blue for the one call to action.
- Music: "Sunny SF Drone Flight", made in Google Flow Music (bright pop instrumental, 120 BPM, D major). Its first drop lands on the cut to Cuso.
- Sound mixed to -14 LUFS (web and social), the music ducked under the voice.

## Shots

| # | Time | Hour | Place | Camera | On screen | Music |
|---|------|------|-------|--------|-----------|-------|
| 1 | 0:00 to 0:14 | 06:00 | The Golden Gate | One drone take. Low over the Pacific, just over the fog; the bridge grows out of the haze; it climbs, crosses the deck at mid span and banks right to the city, the sun rising behind the Transamerica Pyramid. | 0:01 `San Francisco, 06:00`. 0:10 `Marketing, on autopilot.` | Airy intro; riser from 0:12. |
| 2 | 0:14 to 0:18 | 06:00 | Russian Hill, a rooftop | Fast push in on Cuso waving, the Golden Gate behind him; the lens punches in. | `Meet Cuso, your AI CMO.` | The drop. |
| 3 | 0:18 to 0:22 | 07:00 | Golden Gate Park | A dive from over Ocean Beach, then a glide just over the trees down the park towards downtown. | `Golden Gate Park, 07:00` | |
| 4 | 0:22 to 0:25 | 07:00 | Hayes Valley, the coffee shop | Quick arc round Cuso that settles. | `07:00` / `Learns your brand` | |
| 5 | 0:25 to 0:28 | 09:00 | The Mission, the mural | Quick arc. | `09:00` / `Runs your social` | |
| 6 | 0:28 to 0:31 | 12:00 | Union Square | Low push up at Cuso by the billboard. | `12:00` / `Runs your ads` | |
| 7 | 0:31 to 0:35 | 15:00 | Transamerica Pyramid | Crane up the Pyramid to Cuso on the tip, the bay and the Bay Bridge behind him. | `15:00` / `Gets you found on Google` | |
| 8 | 0:35 to 0:40 | 18:00 | Ferry Building | From over the bay on the clock tower at sunset, down Market Street, round to face Cuso at the cable car stop. | `18:00` / `Sends your newsletter` | |
| 9 | 0:40 to 0:46 | 22:00 | Embarcadero, the pier | Close on Cuso at his laptop under the Bay Bridge lights, a slow crane up. | `22:00` / `Learns while you sleep` | The breakdown. |
| 10 | 0:46 to 0:52 | 06:00 next day | Russian Hill, the rooftop | Close on Cuso at dawn, then a long pull back and up until the whole city is in frame. | `Your city. Your CMO.` with a Cuso blue pill `Join the waitlist at cmo.xyz` | The big drop. |

## Voice over

Made by `scripts/film-voice.mjs` through OpenRouter's speech API: ElevenLabs Eleven v4, voice Jessica (bright, playful). The script writes the name as it sounds, "Koo-so" (KOO-so), and spells out C M O; every line was checked by transcribing it back (Whisper). Other voices: `--voice Laura|Sarah|Will|Liam|Eric`.

Each line is heard with its title (titles fade in 0.2 s after their cut). Checked on the finished files: the titles read off the frames by OCR, each line found in the film's audio by matching it against the raw voice file, and the music's drops found the same way (on the cuts at 0:14 and 0:46, within 5 ms).

| Starts | Line | With the title |
|--------|------|----------------|
| 0:02.0 | "Every morning, the fog rolls in. And every morning, Cuso goes to work." | `San Francisco, 06:00` |
| 0:14.4 | "This is Cuso. Your AI CMO." | `Meet Cuso, your AI CMO.` |
| 0:22.4 | "He learns your brand." | `Learns your brand` |
| 0:25.4 | "Runs your social." | `Runs your social` |
| 0:28.4 | "Runs your ads." | `Runs your ads` |
| 0:31.4 | "Gets you found." | `Gets you found on Google` |
| 0:35.4 | "Sends your newsletter." | `Sends your newsletter` |
| 0:40.4 | "And while you sleep, he learns what worked." | `Learns while you sleep` |
| 0:46.4 | "Your city. Your CMO. Join the waitlist at cmo.xyz." | `Your city. Your CMO.` |

## How it is made

- `scripts/film.mjs` holds the shot list as code: camera path, lens, hour and titles per shot. It loads the site in Chromium on the real GPU (Metal), freezes the page clock and steps it one frame at a time, so cars, boats, the cable car and water move at true speed.
- Motion blur: each frame blends 4 camera samples across half a frame (`SUB=4`). 4K is a 1920 x 1080 page at 2 device pixels per pixel (`SCALE=2`). 9:16 (`PORTRAIT=1`) uses the same paths with a wider lens and titles clear of app captions.
- The film hook (`docs/film/film-hook.patch`) lets the script set the camera, Cuso's chapter and a redraw for the blur samples, and keeps full resolution while rendering. It is applied to a private copy of the project, never to the live branch.
- The song is 120 BPM: the film starts 2.42 s into it, so its downbeat at 16.42 s is the cut to Cuso. Every shot is a whole number of beats long.
- `scripts/film-voice.mjs` makes the voice lines; `scripts/film-mix.mjs` cuts the song, places the lines (each set to the same loudness), ducks the music and sets loudness.

### Run it

In a copy of the project with the patch applied, built and served on port 3200 (`pnpm build && pnpm start --port 3200`):

```
node scripts/film.mjs stills <dir>                                  # 3 stills per shot, to check framing
W=1920 H=1080 SCALE=2 SUB=4 node scripts/film.mjs render <dir>      # 4K master, about 12 min
PORTRAIT=1 SUB=4 node scripts/film.mjs render <dir>                 # 9:16, about 7 min
node scripts/film.mjs render <dir> park && node scripts/film.mjs join <dir>   # redo one shot
node scripts/film-voice.mjs <vo-dir> [--voice Jessica] [--lines 1,2] # needs ~/.config/cmo-film/openrouter.env
node scripts/film-mix.mjs <song.wav> <vo-dir> <audio-dir>           # music.wav, mix-vo.wav
ffmpeg -i <dir>/film.mp4 -i <audio-dir>/mix-vo.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest out.mp4
```

## Outputs

In `out/film/` (git ignored):

- `cuso-city-4k-vo.mp4`: the master, 4K, music and voice.
- `cuso-city-4k.mp4`: the same, music only.
- `cuso-city-9x16.mp4`: the social cut, music and voice.
- `cuso-city-preview.mp4`: a 1080p copy for sharing.
- `audio/`: `music.wav`, `mix-vo.wav` and `vo-lines/`, for an editor.
- The song's full file is "Sunny SF Drone Flight.wav" in Downloads (2:37).

## Still open

- Check Flow Music's terms for commercial use of the song before the film goes public.
- A human voice, if the TTS voice is not good enough. `out/film/voice-audition.mp3` has the six voices tried.
