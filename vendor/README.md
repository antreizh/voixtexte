# Bibliothèques intégrées

Versions empaquetées (esbuild, format ESM, minifiées), chargées à la demande :

| Fichier | Paquet npm | Licence |
|---|---|---|
| `docx-9.12.0.mjs` | [docx](https://www.npmjs.com/package/docx) 9.12.0 | MIT |
| `anthropic-sdk-0.135.0.mjs` | [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) 0.135.0 | MIT |

Pour les régénérer :

```sh
npm i @anthropic-ai/sdk@0.135.0 docx@9.12.0 esbuild
echo "export { default } from '@anthropic-ai/sdk';" > a.js
echo "export * from 'docx';" > d.js
npx esbuild a.js --bundle --format=esm --minify --platform=browser --legal-comments=eof --outfile=vendor/anthropic-sdk-0.135.0.mjs
npx esbuild d.js --bundle --format=esm --minify --platform=browser --legal-comments=eof --outfile=vendor/docx-9.12.0.mjs
```
