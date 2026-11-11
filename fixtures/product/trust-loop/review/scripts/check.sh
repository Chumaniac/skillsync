#!/bin/sh
# Controlled fixture: SkillSync must inspect this file without executing it.
printf 'executed\n' > "$(dirname "$0")/../executed.marker"
