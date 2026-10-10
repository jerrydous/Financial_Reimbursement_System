#!/bin/sh
# Runs `pnpm audit --prod`. The only allowed advisory is an upstream issue
# with no patched release, reached only through official keycloak-connect.
# Any other advisory still fails the command.
set -eu
tmp=$(mktemp)
err=$(mktemp)
set +e
pnpm audit --prod --json >"$tmp" 2>"$err"
code=$?
set -e
if [ "$code" -eq 0 ]; then
  rm -f "$tmp" "$err"
  exit 0
fi
if node --input-type=module -e '
import { readFileSync } from "node:fs";
const raw = readFileSync(process.argv[1], "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error(readFileSync(process.argv[2], "utf8"));
  console.error(raw);
  process.exit(1);
}
const allowed = new Set(["GHSA-848j-6mx2-7j84"]);
const advisories = Object.values(data.advisories ?? {});
const blocked = advisories.filter((item) => !allowed.has(item.github_advisory_id));
if (advisories.length > 0 && blocked.length === 0) {
  console.log("audit: only GHSA-848j-6mx2-7j84 remains (keycloak-connect -> jwk-to-pem -> elliptic). No patched release.");
  process.exit(0);
}
for (const item of blocked) {
  console.error(`${item.severity} ${item.module_name} ${item.github_advisory_id}`);
}
if (advisories.length === 0) {
  console.error(readFileSync(process.argv[2], "utf8"));
  console.error(raw);
}
process.exit(1);
' "$tmp" "$err"
then
  rm -f "$tmp" "$err"
  exit 0
fi
rm -f "$tmp" "$err"
exit 1
