// The film's sound: the Flow Music track ("Sunny SF Drone Flight", 120 BPM) cut to the
// picture, and the voice over lines (scripts/film-voice.mjs) placed on their shots, the music
// ducked under them. Loudness -14 LUFS (web and social).
//
// Usage: node scripts/film-mix.mjs <song.wav> <vo-lines-dir> <out-dir>
// Writes music.wav (music only) and mix-vo.wav (music and voice), both 52 s.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const [song, lines, out] = process.argv.slice(2);
if (!song || !lines || !out) throw new Error("usage: node scripts/film-mix.mjs <song.wav> <vo-lines-dir> <out-dir>");
mkdirSync(out, { recursive: true });

const LENGTH = 52;
/** The song's downbeat at 16.42 s is its first drop: it lands on the cut to Cuso (0:14). */
const SONG_START = 16.42 - 14;
/**
 * When each line starts in the film (seconds): with its title (titles fade in 0.2 s after
 * their cut; checked by reading them off the rendered film). The opening line comes with
 * "San Francisco, 06:00". The cuts: 14, 18, 22, 25, 28, 31, 35, 40, 46.
 */
const CUES = [2.0, 14.4, 22.4, 25.4, 28.4, 31.4, 35.4, 40.4, 46.4];

const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
/** Measure, then apply the exact gain to -14 LUFS with a limiter at -1 dBFS (one-pass loudnorm on 52 s missed by 2 dB). */
function loudness(name) {
  const raw = `${out}/${name}.raw.wav`;
  const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const measured = Number(stderr.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/)?.[1]);
  if (!Number.isFinite(measured)) throw new Error(`could not measure ${raw}`);
  ff("-i", raw, "-af", `volume=${(-14 - measured).toFixed(2)}dB,alimiter=limit=0.89:level=false`, "-ar", "48000", `${out}/${name}.wav`);
  rmSync(raw);
}
const bed = `[0:a]atrim=0:${LENGTH},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.2,afade=t=out:st=${LENGTH - 1.5}:d=1.5`;

ff("-ss", String(SONG_START), "-i", song, "-filter_complex", `${bed}[o]`, "-map", "[o]", "-ar", "48000", `${out}/music.raw.wav`);
loudness("music");

// Each line goes into its own 52 s file: real silence up to its cue, then the line (trimmed of its
// leading silence, set to one loudness). Written from sample 0, so nothing downstream can shift it:
// placing lines with adelay after silenceremove kept their old timestamps, and the mixer then
// wrote the whole track early by the first cue.
const placed = CUES.map((t, i) => {
  const file = `${out}/line-${i + 1}.wav`;
  const line = "[1:a]aresample=48000,silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-20:TP=-2,aresample=48000,highpass=f=80,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[l]";
  ff("-f", "lavfi", "-t", String(t), "-i", "anullsrc=r=48000:cl=mono", "-i", `${lines}/${String(i + 1).padStart(2, "0")}.wav`, "-filter_complex", `${line};[0:a][l]concat=n=2:v=0:a=1,apad=whole_dur=${LENGTH},atrim=0:${LENGTH}[o]`, "-map", "[o]", file);
  return file;
});
const vo = `${CUES.map((_, i) => `[${i + 1}:a]`).join("")}amix=inputs=${CUES.length}:normalize=0,alimiter=limit=0.8,pan=stereo|c0=c0|c1=c0,asplit[vo][key]`;
const mix = `${bed}[m];[m][key]sidechaincompress=threshold=0.02:ratio=5:attack=20:release=350[duck];[duck][vo]amix=inputs=2:duration=first:normalize=0:weights=1 1.6[o]`;
ff("-ss", String(SONG_START), "-i", song, ...placed.flatMap((f) => ["-i", f]), "-filter_complex", `${vo};${mix}`, "-map", "[o]", "-ar", "48000", `${out}/mix-vo.raw.wav`);
placed.forEach((f) => rmSync(f));
loudness("mix-vo");
console.log(`${out}: music.wav mix-vo.wav (${LENGTH} s)`);
