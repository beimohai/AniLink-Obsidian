"use strict";
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  cp = require("child_process");
cp.execFileSync(process.execPath, ["build.js"], { stdio: "inherit" });
cp.execFileSync(process.execPath, ["scripts/review-audit.cjs"], {
  stdio: "inherit",
});
const manifest = JSON.parse(fs.readFileSync("manifest.json")),
  target = path.resolve("dist", "anilink");
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(target))
  if (
    !["main.js", "manifest.json", "styles.css", "align-audio.py"].includes(name)
  )
    throw Error("Unexpected file in package: " + name);
const sums = [];
for (const name of [
  "main.js",
  "manifest.json",
  "styles.css",
  "align-audio.py",
]) {
  const source = name === "align-audio.py" ? path.join("scripts", name) : name;
  fs.copyFileSync(source, path.join(target, name));
  sums.push(
    crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex") +
      "  " +
      name,
  );
}
fs.writeFileSync(
  path.resolve("dist", "SHA256SUMS.txt"),
  sums.join("\n") + "\n",
);
console.log(
  "Prepared local install folder: " +
    target +
    " (" +
    manifest.version +
    "). No publishing performed.",
);
