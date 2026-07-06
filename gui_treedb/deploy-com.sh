#!/bin/sh

NODE="artgins.ytreedb.com"

rsync -avzL --delete \
    --exclude \.webassets-cache --exclude \.sass-cache --exclude \.cache \
    --filter 'P images/*' \
    ./dist/ \
    "yuneta@$NODE:/yuneta/gui/$NODE"
