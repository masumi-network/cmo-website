// The voice over for "One day in Cuso's City" (docs/film/script.md): one wav per line from
// OpenRouter's speech API (default ElevenLabs Eleven v4). The key is read from
// ~/.config/cmo-film/openrouter.env and never printed.
//
// Usage: node scripts/film-voice.mjs <out-dir> [--model id] [--voice name] [--lines 1,2]
// Writes <out-dir>/01.wav .. 09.wav (only the listed lines with --lines).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const out = args[0];
if (!out || out.startsWith("--")) throw new Error("usage: node scripts/film-voice.mjs <out-dir> [--model id] [--voice name] [--lines 1,2]");
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : fallback;
};
const MODEL = opt("model", "elevenlabs/eleven-v4");
const VOICE = opt("voice", "Jessica");

// Written for the ear: the name as it sounds (KOO-so), letters spelled out.
const LINES = [
  "Every morning, the fog rolls in. And every morning, Koo-so goes to work.",
  "This is Koo-so. Your A.I. C.M.O.",
  "He learns your brand.",
  "Runs your social.",
  "Runs your ads.",
  "Gets you found.",
  "Sends your newsletter.",
  "And while you sleep, he learns what worked.",
  "Your city. Your C.M.O. Join the waitlist at C.M.O. dot X.Y.Z.",
];
const pick = opt("lines", "")
  .split(",")
  .filter(Boolean)
  .map(Number);
const todo = LINES.map((text, i) => ({ n: i + 1, text })).filter(({ n }) => !pick.length || pick.includes(n));

const env = readFileSync(join(homedir(), ".config/cmo-film/openrouter.env"), "utf8");
const key = env.match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1].trim();
if (!key) throw new Error("~/.config/cmo-film/openrouter.env has no OPENROUTER_API_KEY line");

mkdirSync(out, { recursive: true });
for (const { n, text } of todo) {
  const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, response_format: "mp3" }),
  });
  if (!res.ok) {
    // the error body names the problem (a bad voice or model); it never echoes the key
    console.error(`line ${n}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
    continue;
  }
  const file = join(out, `${String(n).padStart(2, "0")}.wav`);
  const mp3 = `${file}.mp3`;
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp3, "-ar", "48000", "-ac", "1", file]);
  execFileSync("rm", [mp3]);
  const secs = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
  console.log(`${file} ${Number(secs).toFixed(2)} s (${MODEL}, ${VOICE})`);
}
