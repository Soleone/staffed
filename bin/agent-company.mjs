#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
