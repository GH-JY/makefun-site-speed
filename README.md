# makefun-site-speed

A faster, byte-identical drop-in for make.fun's makefun-site 1.0.0 static site generator. `solve.js` is a dependency-free ES module whose `run(input)` returns the same output tree that makefun-site 1.0.0's build returns for every case, and `main.ts` answers every case of the input set with it.

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/GH-JY/makefun-site-speed/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/GH-JY/makefun-site-speed/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

The entry keeps makefun-site's output byte for byte while doing far less work per page: one fused Markdown pass, ordered front matter parsing, pre-compiled template nodes, and a single report at the end.

## Run it

```sh
node main.ts
```

It reads the cases from `/input/cases.json` (or `MAKEFUN_INPUT_DIR`) and writes the answers to `/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`), one answer per case in order.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
