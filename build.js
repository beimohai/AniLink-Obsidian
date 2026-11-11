"use strict";
const fs = require("fs");
const core = fs.readFileSync("core.js", "utf8").replace(/\r\n?/g, "\n");
const source = fs
  .readFileSync("src/main.js", "utf8")
  .replace(
    /module\.exports\s*=\s*AniLink\s*;/,
    () =>
      [
        "integration",
        "workspace",
        "backends",
        "polish",
        "tasks",
        "experience",
        "control",
        "workflow",
        "ux",
        "community",
        "device-sync",
      ]
        .map((f) =>
          fs
            .readFileSync("src/" + f + ".js", "utf8")
            .replace(
              /require\("\.\/sync-model"\)/,
              () =>
                `(()=>{const module={exports:{}};${fs.readFileSync("src/sync-model.js", "utf8").replace(/^"use strict";/, "")}\nreturn module.exports;})()`,
            ),
        )
        .join("\n") + "\nmodule.exports=AniLink;",
  );
fs.writeFileSync(
  "main.js",
  source.replace(/\r\n?/g, "\n").replace(
    /require\((['"])\.\/core\1\)/,
    () => `(()=>{const module={exports:{}};${core.replace(/^"use strict";/, "")}\nreturn module.exports;})()`,
  ),
);
console.log("Built main.js (no external runtime dependencies)");


const audio = fs.readFileSync("scripts/align-audio.py", "utf8").replace(/\r\n?/g, "\n");
fs.appendFileSync("main.js", "\nAniLink.prototype.bundledAudioScript = " + JSON.stringify(audio) + ";\n");
