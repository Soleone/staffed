# Browser demo

The live demo at https://staffed.soleone.xyz: the real CLI in a WebContainers sandbox. The home folder has an empty `~/.claude`, so `staffed enable` detects Claude Code and installs the roles and skill there. No agent runs.

```sh
pnpm demo   # builds this folder into dist/browser and serves it at http://127.0.0.1:4321
```

Deploy `dist/browser` as a static site; it includes the `vercel.json` with the COOP/COEP headers the sandbox needs.
