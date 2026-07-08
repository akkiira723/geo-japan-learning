#!/bin/bash

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node -e "
let d = '';
process.stdin.on('data', (c) => (d += c));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(d);
    process.stdout.write((j.tool_input && j.tool_input.command) || '');
  } catch (e) {}
});
")

# geo-japan-learning is a public repo that auto-deploys to GitHub Pages on
# push to main. Normal `git push` stays allowed (still gated by the
# assistant's own confirm-before-push practice) — only destructive/history-
# rewriting operations are hard-blocked here.
DANGEROUS_PATTERNS=(
  "push --force"
  "push -f( |$)"
  "--force-with-lease"
  "reset --hard"
  "clean -fd"
  "clean -f"
  "branch -D"
  "checkout \."
  "restore \."
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE -- "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
