"use strict";
const fs = require("fs");
const core = fs.readFileSync("core.js", "utf8").replace(/\r\n?/g, "\n");
const icon = fs.readFileSync("assets/branding/anilink-icon-white.svg", "utf8").replace(/#fff/g, "currentColor");
const iconBody = '<g transform="scale(0.09765625)">' + icon.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '') + '</g>';
const source = ("\"use strict\";\nconst ANI_ICON = " + JSON.stringify(icon) + ";\nconst ANI_ICON_BODY = " + JSON.stringify(iconBody) + ";\n") + fs
  .readFileSync("src/main.js", "utf8")
  .replace(/^"use strict";\s*/, "")
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
        "remote",
        "ux",
        "community",
        "settings",
        "device-sync",
        "preferences-runtime",
        "aniclip",
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
fs.appendFileSync("main.js", "\nAniLink.prototype.bundledFocusScript = " + JSON.stringify(fs.readFileSync("scripts/focus-player.ps1", "utf8")) + ";\n");
