#!/bin/zsh
# Double-click in Finder to open the reward-per-health graph.
set -e
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
if [[ ! -d node_modules ]]; then
  echo "Dependencies are missing. Run 'npm install' in the project first."
  read -r "?Press Return to close..."
  exit 1
fi
npm run balance:reward-health
