#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
source ~/.nvm/nvm.sh
nvm use v18
node $SCRIPT_DIR/updateEarnings.js
