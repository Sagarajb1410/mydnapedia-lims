#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and then double-click this file again."
  read -r -p "Press Enter to close."
  exit 1
fi
node --no-warnings src/server.js --demo --open
read -r -p "The LIMS has stopped. Press Enter to close." 
