#!/bin/sh
set -eu
mkdir -p /tmp/rc6-source /tmp/npm-cache
cd /tmp/rc6-source
tar xf /input/source.tar
node --version
cat /etc/os-release
node --input-type=module -e "import('./scripts/docker-prerequisites.mjs').then(async ({inspectDocker}) => { const r=await inspectDocker(); console.log(r); if(r.reason!=='not_installed') process.exit(2) })"
npm ci
npm run desktop:build
node --import tsx tests/missing-docker-e2e.mjs
