import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // R3F mutates three.js objects (materials, lights, fog) inside useFrame by
  // design. The React Compiler immutability rule does not fit that model.
  { files: ["src/scene/**"], rules: { "react-hooks/immutability": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "public/draco/**",
  ]),
]);

export default eslintConfig;
