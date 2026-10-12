# Design sources

- Canvas (approved 2026-10-12): https://claude.ai/artifact/KCZCH6RDZW8L3BTgPYHwxT
- `prompts/`: one Codex image-gen prompt per concept shot. `_style.txt` is appended to every prompt.
- Rendered concepts live in `public/concepts/`. The site uses them as posters and as the no-WebGL fallback.

Regenerate a shot (run from a folder that holds `prompts/`, `_style.txt` and the two reference images):

```bash
{ echo "Use your image generation tool to create ONE image and save it as shots/NAME.png"; cat prompts/NAME.txt prompts/_style.txt; } | codex exec --skip-git-repo-check -s workspace-write -i ref-cuso.png -i ref-sheet.webp
```
