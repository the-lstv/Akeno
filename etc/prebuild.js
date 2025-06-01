const { execSync } = require("child_process");
const fs = require("fs");

const package = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (!package.version) {
    throw new Error("Version not found in package.json");
}

const hash = execSync("git rev-parse --short HEAD").toString().trim();

package.version = `${package.version.replace(/\+.*/, "")}+${hash}`;

fs.writeFileSync("package.json", JSON.stringify(package, null, 2) + "\n");
console.log(`Updated hash for ${package.version}`);